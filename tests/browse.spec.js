const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * The browse screen: one horizontally scrolling row per channel, driven by the
 * four arrow keys and Enter, because that is all a TV remote offers.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vScJOEVp-KGJPXKnyS56qFBN-400qvNW_P1EUGBcGA9BfXJZV3VQUD_m2afqdFull9zxBJv3dpDsAmX/pub?gid=0&single=true&output=csv';

/** How many channels the app should manage to show, worked out from the same
 *  two inputs it uses. Hard-coding a number here would mean the suite breaks
 *  every time a channel is added to the Sheet. */
async function expectedChannelCount() {
  const csv = await fetch(SHEET_CSV).then((r) => r.text());
  const handles = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'docs', 'handles.json'), 'utf8')
  );
  return csv
    .split('\n')
    .slice(1)
    .filter((line) => {
      if (/UC[\w-]{22}/.test(line)) return true;
      const m = line.match(/@([A-Za-z0-9._-]+)/);
      return m ? Boolean(handles['@' + m[1].toLowerCase()]) : false;
    }).length;
}

/** Rows exist as empty shells while their videos load, so "a row" means a
 *  filled one. */
const filled = (page) => page.locator('.row:not(.loading)');

async function loadGrid(page) {
  await page.goto('/index.html');
  const n = await expectedChannelCount();
  await expect(filled(page)).toHaveCount(n, { timeout: 90_000 });
  await expect(page.locator('#status')).toHaveText('');
  return n;
}

test('renders one row per channel listed in the Sheet', async ({ page }) => {
  const n = await loadGrid(page);
  expect(n).toBeGreaterThan(1);

  // Every row carries real cards, and no shell is left stranded.
  await expect(page.locator('.row.loading')).toHaveCount(0);
  for (const row of await filled(page).all()) {
    expect(await row.locator('.card').count()).toBeGreaterThan(5);
  }

  // Headings start as the raw @handle and must be replaced by the channel's
  // real name once its metadata arrives.
  const headings = await page.locator('.row h2').allTextContents();
  expect(headings.filter((h) => h.startsWith('@'))).toEqual([]);

  await page.screenshot({ path: 'test-results/browse.png' });
});

test('each row really holds the channel it is labelled with', async ({ page }) => {
  // Regression guard. Reading every channel through one shared player and
  // re-pointing it with cuePlaylist() returned the PREVIOUS channel's list for a
  // full cycle: rows shifted by one and a channel silently vanished. On a
  // parental-control screen a row can never show a channel other than the one
  // named on it, so this asserts the pairing, not just the count.
  await loadGrid(page);

  const pairs = await page.evaluate(async () => {
    const out = [];
    for (const row of document.querySelectorAll('.row:not(.loading)')) {
      const id = row.querySelector('.card img').src.match(/\/vi\/([\w-]{11})\//)[1];
      const meta = await fetch(
        'https://www.youtube.com/oembed?format=json&url=' +
          encodeURIComponent('https://www.youtube.com/watch?v=' + id)
      ).then((r) => (r.ok ? r.json() : null));
      if (meta) out.push({ label: row.querySelector('h2').textContent.trim(), owner: meta.author_name.trim() });
    }
    return out;
  });

  expect(pairs.length).toBeGreaterThan(1);
  for (const { label, owner } of pairs) expect(label).toBe(owner);
});

test('captions are trimmed to two lines and never spill out of their card', async ({ page }) => {
  // -webkit-line-clamp silently does nothing here — Chromium computes the
  // caption's display as flow-root — so the two-line limit is enforced by an
  // exact content height with the spacing as margin. Bottom padding would let a
  // third line paint inside it and show as a sliced-off strip.
  await loadGrid(page);

  const spilling = await page.evaluate(() =>
    [...document.querySelectorAll('.card')].filter((card) => {
      const cap = card.querySelector('.cap');
      return cap.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom + 0.5;
    }).length
  );
  expect(spilling).toBe(0);
});

test('titles are only fetched for cards the viewer can reach', async ({ page }) => {
  // Fifteen rows of sixty cards is nearly nine hundred videos; fetching a title
  // for every one of them on load would be pointless traffic on a TV.
  await loadGrid(page);

  const { total, named } = await page.evaluate(() => {
    const caps = [...document.querySelectorAll('.cap')];
    return { total: caps.length, named: caps.filter((c) => c.textContent !== '…').length };
  });

  expect(total).toBeGreaterThan(100);
  expect(named).toBeGreaterThan(0);
  expect(named).toBeLessThan(total);
});

test('arrow keys move focus across and between rows', async ({ page }) => {
  await loadGrid(page);

  await expect(filled(page).nth(0).locator('.card').nth(0)).toHaveClass(/focused/);

  await page.keyboard.press('ArrowRight');
  await expect(filled(page).nth(0).locator('.card').nth(1)).toHaveClass(/focused/);

  await page.keyboard.press('ArrowDown');
  await expect(filled(page).nth(1).locator('.card').nth(1)).toHaveClass(/focused/);

  // Left at the start of a row must not wrap to the previous row.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(filled(page).nth(1).locator('.card').nth(0)).toHaveClass(/focused/);
});

test('Enter opens the player and Back returns to the grid', async ({ page }) => {
  await loadGrid(page);

  await expect(page.locator('#stage')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#stage iframe')).toBeVisible();
  await page.screenshot({ path: 'test-results/playing.png' });

  // Back must work even while the player is still loading: YT.Player hands back
  // an object before its methods exist, and calling one early used to throw
  // inside closeStage() and leave the video stuck on screen.
  await page.keyboard.press('Escape');
  await expect(page.locator('#stage')).toBeHidden();
});
