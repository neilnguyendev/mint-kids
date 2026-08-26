const { test, expect } = require('@playwright/test');

/**
 * Mint Kids reads every piece of its data without a YouTube API key. That is only
 * possible because of three specific behaviours of third-party services, none of
 * which we control. Each test below pins one of them, so if YouTube or Google
 * changes its mind we find out from a failing test rather than from a black screen
 * on the TV.
 */

const CHANNEL_ID = 'UCTl91e4cxOjpphrLuNXVQ2A';          // @Lingokids
const UPLOADS = 'UU' + CHANNEL_ID.slice(2);              // uploads-playlist convention
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vScJOEVp-KGJPXKnyS56qFBN-400qvNW_P1EUGBcGA9BfXJZV3VQUD_m2afqdFull9zxBJv3dpDsAmX/pub?gid=0&single=true&output=csv';

// Every test needs a document on our own origin before it can make a
// cross-origin request that means anything. It must be a BLANK document, not the
// app: index.html boots app.js, which loads the IFrame API and consumes the
// one-shot onYouTubeIframeAPIReady callback before a test can register for it.
test.beforeEach(async ({ page }) => {
  await page.route('**/__blank__', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>test</title>' })
  );
  await page.goto('/__blank__');
});

test('the published Google Sheet is readable cross-origin, at least sometimes', async ({ page }) => {
  // Google throttles this hard from a browser origin: measured at three
  // successes in eight consecutive tries, the rest hanging past twelve seconds.
  // That is exactly why the app has a fallback chain — Sheet, then the cached
  // last answer, then the copy shipped beside the app — and why this asserts
  // "reachable at all" rather than "reachable on demand". If Google shut the
  // endpoint off entirely, every attempt would fail and this would go red.
  const attempts = await page.evaluate(async (url) => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      const started = Date.now();
      try {
        const r = await Promise.race([
          fetch(url + '&probe=' + i),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
        ]);
        results.push({ ok: r.ok, body: (await r.text()).slice(0, 200), ms: Date.now() - started });
        if (r.ok) break;
      } catch (e) {
        results.push({ ok: false, error: e.message, ms: Date.now() - started });
      }
    }
    return results;
  }, SHEET_CSV);

  const good = attempts.find((a) => a.ok);
  expect(good, `every attempt failed: ${JSON.stringify(attempts)}`).toBeTruthy();
  expect(good.body).toContain('youtube.com');
});

test('oEmbed returns a video title cross-origin', async ({ page }) => {
  const data = await page.evaluate(async () => {
    const r = await fetch(
      'https://www.youtube.com/oembed?format=json&url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=h9ib0SO5b2U')
    );
    return r.ok ? r.json() : null;
  });

  expect(data).not.toBeNull();
  expect(data.title).toBeTruthy();
  expect(data.author_name).toContain('Lingokids');
});

test('the IFrame player loads a channel uploads playlist without a key', async ({ page }) => {
  // The player fetches the playlist itself, so no cross-origin request is ever
  // made from our code — which is exactly why this works where the RSS feed,
  // which sends no CORS headers at all, does not.
  const ids = await page.evaluate(async (uploads) => {
    await new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('iframe_api failed to load'));
      document.head.appendChild(s);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const player = await new Promise((resolve) => {
      const p = new YT.Player(host, {
        height: 200,
        width: 320,
        playerVars: { listType: 'playlist', list: uploads, autoplay: 0 },
        events: { onReady: () => resolve(p) },
      });
    });

    // getPlaylist() is populated a beat after onReady, so poll rather than
    // sleeping on a guessed delay.
    for (let i = 0; i < 40; i++) {
      const list = player.getPlaylist();
      if (list && list.length) return list;
      await new Promise((r) => setTimeout(r, 250));
    }
    return [];
  }, UPLOADS);

  expect(ids.length).toBeGreaterThan(100);
  // Video ids are 11 characters; anything else means we read the wrong thing.
  expect(ids[0]).toMatch(/^[\w-]{11}$/);
});

test('the RSS feed is still CORS-blocked, so the playlist route stays necessary', async ({ page }) => {
  // A guard against a future refactor "simplifying" this back to fetching RSS.
  const blocked = await page.evaluate(async (channelId) => {
    try {
      await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
      return false;
    } catch {
      return true;
    }
  }, CHANNEL_ID);

  expect(blocked).toBe(true);
});
