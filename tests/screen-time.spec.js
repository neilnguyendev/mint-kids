const { test, expect } = require('@playwright/test');
const { stubSheet } = require('./helpers');

/**
 * The daily screen-time budget. The countdown has to survive the app being
 * closed and reopened, or a child defeats it by turning the app off and on
 * again — which is why the state lives in localStorage against today's date
 * rather than in a variable.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const QUOTA_KEY = 'mintkids.quota';
const QUOTA_MS = 30 * 60 * 1000;

/** Puts a budget state in place before any app code runs. */
async function seed(page, state) {
  await page.addInitScript(
    ([key, value]) => {
      try { window.localStorage.setItem(key, value); } catch (e) {}
    },
    [QUOTA_KEY, JSON.stringify(state)]
  );
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const clockSeconds = async (page) => {
  const [m, s] = (await page.locator('#clock-time').textContent()).split(':');
  return Number(m) * 60 + Number(s);
};

test('a fresh day starts at the full thirty minutes', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((k) => localStorage.removeItem(k), QUOTA_KEY);
  await page.reload();

  await expect(page.locator('#clock')).toBeVisible();
  expect(await clockSeconds(page)).toBeGreaterThan(29 * 60);
});

test('the countdown actually counts down', async ({ page }) => {
  await page.goto('/index.html');
  const before = await clockSeconds(page);
  await page.waitForTimeout(3000);
  const after = await clockSeconds(page);

  expect(after).toBeLessThan(before);
  // Roughly wall-clock, not a runaway loop.
  expect(before - after).toBeLessThanOrEqual(5);
});

test('the countdown stays visible over the player', async ({ page }) => {
  // The moment a child most needs to see time running out is mid-video, so the
  // clock has to sit above the player rather than behind it.
  await stubSheet(page);
  await page.goto('/index.html');
  await expect(page.locator('.row:not(.loading)').first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(2000);

  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#clock')).toBeVisible();

  const clockZ = await page.evaluate(() => +getComputedStyle(document.getElementById('clock')).zIndex);
  const stageZ = await page.evaluate(() => +getComputedStyle(document.getElementById('stage')).zIndex);
  expect(clockZ).toBeGreaterThan(stageZ);
});

test('time already spent today is remembered across a restart', async ({ page }) => {
  // Without this, closing and reopening the app hands out a fresh half hour.
  await seed(page, { day: todayKey(), usedMs: 25 * 60 * 1000 });
  await page.goto('/index.html');

  const left = await clockSeconds(page);
  expect(left).toBeLessThanOrEqual(5 * 60);
  expect(left).toBeGreaterThan(4 * 60);
});

test('yesterday\'s spending does not carry over', async ({ page }) => {
  await seed(page, { day: '2020-1-1', usedMs: QUOTA_MS });
  await page.goto('/index.html');

  expect(await clockSeconds(page)).toBeGreaterThan(29 * 60);
  await expect(page.locator('#timeup')).toBeHidden();
});

test('when the budget is spent it says so and nothing plays', async ({ page }) => {
  await seed(page, { day: todayKey(), usedMs: QUOTA_MS });
  await page.goto('/index.html');

  await expect(page.locator('#timeup')).toBeVisible();
  await expect(page.locator('#timeup')).toContainText('Đã xem hết giờ hôm nay');

  // The message must cover the grid, and Enter must not start a video behind it.
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeHidden();

  const covers = await page.evaluate(() => {
    const r = document.getElementById('timeup').getBoundingClientRect();
    return r.width >= window.innerWidth && r.height >= window.innerHeight;
  });
  expect(covers).toBe(true);

  await page.screenshot({ path: 'test-results/time-up.png' });
});

test('a video already playing is stopped when time runs out', async ({ page }) => {
  // One second left, so the budget expires while the video is on screen.
  await seed(page, { day: todayKey(), usedMs: QUOTA_MS - 1500 });
  await stubSheet(page);
  await page.goto('/index.html');
  await expect(page.locator('.row:not(.loading)').first()).toBeVisible({ timeout: 90_000 });

  await page.keyboard.press('Enter');
  await expect(page.locator('#timeup')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#stage')).toBeHidden();
});
