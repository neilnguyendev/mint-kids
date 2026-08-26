const { test, expect } = require('@playwright/test');
const { SHEET_GLOB, csvFor } = require('./helpers');

/**
 * The channel list comes from a published Google Sheet — a third party, over the
 * open internet, fetched on every launch. It has been seen hanging well past ten
 * seconds, and a hang there used to leave the screen stuck on "loading" with no
 * way for a child to recover.
 *
 * These drive the Sheet from a stub rather than the live document: the real one
 * is already covered in data-access.spec.js, and depending on it here made the
 * assertions race a third party.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const CACHE_KEY = 'mintkids.channels';

/** Puts a previously-loaded channel list in the cache before any app code runs. */
async function seedCache(page, csv) {
  await page.addInitScript(
    ([key, value]) => {
      try { localStorage.setItem(key, JSON.stringify({ csv: value, at: Date.now() })); } catch (e) {}
    },
    [CACHE_KEY, csv]
  );
}

test('a Sheet that never answers does not hang the screen forever', async ({ page }) => {
  await page.route(SHEET_GLOB, () => {});             // never resolves
  await page.route('**/channels.json*', (route) => route.abort());
  await page.goto('/index.html');

  // The wait is bounded: without a timeout this used to sit on "loading" for
  // ever, which on a TV is indistinguishable from a broken app.
  await expect(page.locator('#status')).toContainText('không đọc được danh sách kênh', {
    timeout: 30_000,
  });
  await expect(page.locator('#status')).toHaveClass(/error/);
});

test('a successful load fills the cache for next time', async ({ page }) => {
  await page.route(SHEET_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv', body: csvFor(['@Numberblocks']) })
  );
  await page.goto('/index.html');
  await expect(page.locator('.row:not(.loading)')).toHaveCount(1, { timeout: 90_000 });

  const cached = await page.evaluate((k) => localStorage.getItem(k), CACHE_KEY);
  expect(JSON.parse(cached).csv).toContain('@Numberblocks');
});

test('an unreachable Sheet falls back to the last list that loaded', async ({ page }) => {
  await seedCache(page, csvFor(['@Numberblocks', '@SciShowKids']));
  await page.route(SHEET_GLOB, (route) => route.abort());
  await page.goto('/index.html');

  // The child still gets their channels, and the screen says so plainly.
  await expect(page.locator('.row:not(.loading)')).toHaveCount(2, { timeout: 90_000 });
  await expect(page.locator('#status')).toContainText('danh sách kênh đã lưu');
  await expect(page.locator('#status')).toHaveClass(/error/);
});

test('the Sheet wins over the cache, so a removed channel disappears', async ({ page }) => {
  // Cache-first would keep serving a channel the parent just deleted for a whole
  // extra session, which is the wrong way round for a parental control.
  await seedCache(page, csvFor(['@Numberblocks', '@SciShowKids']));
  await page.route(SHEET_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv', body: csvFor(['@Numberblocks']) })
  );
  await page.goto('/index.html');

  await expect(page.locator('.row:not(.loading)')).toHaveCount(1, { timeout: 90_000 });
  await expect(page.locator('#status')).not.toContainText('đã lưu');
});

test('a TV that has never reached the Sheet still works from the shipped copy', async ({ page }) => {
  // The case that matters on a brand new install: nothing cached, Sheet
  // unreachable. channels.json is committed next to the app and served from the
  // same origin, so it is reachable when the Sheet is not.
  await page.route(SHEET_GLOB, (route) => route.abort());
  await page.goto('/index.html');

  await expect(page.locator('.row:not(.loading)').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#status')).toContainText('kèm theo app');
});

test('the live Sheet still wins over the shipped copy', async ({ page }) => {
  await page.route(SHEET_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv', body: csvFor(['@Numberblocks']) })
  );
  await page.goto('/index.html');

  await expect(page.locator('.row:not(.loading)')).toHaveCount(1, { timeout: 90_000 });
  await expect(page.locator('#status')).not.toContainText('kèm theo app');
});

test('with every source gone it says so rather than sitting blank', async ({ page }) => {
  await page.route(SHEET_GLOB, (route) => route.abort());
  await page.route('**/channels.json*', (route) => route.abort());
  await page.goto('/index.html');

  await expect(page.locator('#status')).toContainText('không đọc được danh sách kênh', {
    timeout: 30_000,
  });
  await expect(page.locator('.row')).toHaveCount(0);
});
