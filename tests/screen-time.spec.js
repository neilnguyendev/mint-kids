const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { stubSheet } = require('./helpers');

/**
 * The daily screen-time budget. It has to survive the app being closed and
 * reopened — a countdown held in a variable is defeated by turning the app off
 * and on again — while not running down during the time the app was shut.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const QUOTA_KEY = 'mintkids.quota';

/** Read the budget from the source rather than restating it, so changing
 *  QUOTA_MINUTES while testing by hand does not turn the suite red. */
const QUOTA_MINUTES = Number(
  fs
    .readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8')
    .match(/var QUOTA_MINUTES = (\d+)/)[1]
);
const QUOTA_MS = QUOTA_MINUTES * 60 * 1000;
const QUOTA_SECONDS = QUOTA_MINUTES * 60;

/** The day boundary the app uses: midnight in Vietnam, whatever the device
 *  clock is set to. */
function vietnamDayKey(atMs = Date.now()) {
  const vn = new Date(atMs + 7 * 60 * 60 * 1000);
  return `${vn.getUTCFullYear()}-${vn.getUTCMonth() + 1}-${vn.getUTCDate()}`;
}

async function seed(page, state) {
  await page.addInitScript(
    ([key, value]) => {
      try { window.localStorage.setItem(key, value); } catch (e) {}
    },
    [QUOTA_KEY, JSON.stringify(state)]
  );
}

const clockSeconds = async (page) => {
  const [m, s] = (await page.locator('#clock-time').textContent()).split(':');
  return Number(m) * 60 + Number(s);
};

test('a fresh day starts at the full budget', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((k) => localStorage.removeItem(k), QUOTA_KEY);
  await page.reload();

  await expect(page.locator('#clock')).toBeVisible();
  expect(await clockSeconds(page)).toBeGreaterThan(QUOTA_SECONDS - 15);
});

test('the countdown actually counts down', async ({ page }) => {
  await stubSheet(page);
  await page.goto('/index.html');

  const startedAt = Date.now();
  const before = await clockSeconds(page);
  await page.waitForTimeout(3000);
  const after = await clockSeconds(page);

  // Compare against the wall clock that actually elapsed. A loaded machine can
  // stretch a 3s wait to 6s, and the countdown is right to follow it — asserting
  // against the requested delay instead makes this fail for being correct.
  const elapsed = Math.ceil((Date.now() - startedAt) / 1000);
  expect(after).toBeLessThan(before);
  expect(before - after).toBeLessThanOrEqual(elapsed + 2);
});

test('closing the app pauses the countdown instead of draining it', async ({ browser }) => {
  // The child watches, the app is shut, and time passes with the TV off. None of
  // that gap belongs to them — only the seconds the app was actually on screen.
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  const first = await context.newPage();
  await first.goto('/index.html');
  await first.waitForTimeout(3000);
  const afterFirstVisit = await clockSeconds(first);
  await first.close();

  // App shut for six seconds.
  await new Promise((r) => setTimeout(r, 6000));

  const second = await context.newPage();   // same origin, same localStorage
  await second.goto('/index.html');
  const onReopen = await clockSeconds(second);

  // Whatever was lost across the gap must be far less than the gap itself.
  expect(afterFirstVisit - onReopen).toBeLessThan(3);
  await context.close();
});

test('time already spent today is remembered across a restart', async ({ page }) => {
  // Without this, closing and reopening hands out a fresh budget.
  const spent = Math.round(QUOTA_MS * 0.6);
  await seed(page, { day: vietnamDayKey(), usedMs: spent });
  await page.goto('/index.html');

  const left = await clockSeconds(page);
  expect(left).toBeLessThanOrEqual(QUOTA_SECONDS * 0.45);
  expect(left).toBeGreaterThan(QUOTA_SECONDS * 0.25);
});

test('yesterday\'s spending does not carry over', async ({ page }) => {
  await seed(page, { day: vietnamDayKey(Date.now() - 24 * 3600 * 1000), usedMs: QUOTA_MS });
  await page.goto('/index.html');

  expect(await clockSeconds(page)).toBeGreaterThan(QUOTA_SECONDS - 15);
  await expect(page.locator('#timeup')).toBeHidden();
});

test.describe('with the TV clock set to another timezone', () => {
  // A set whose timezone is wrong or unset must not get a second allowance, so
  // the day boundary is Vietnam's regardless of what the device believes.
  test.use({ timezoneId: 'America/New_York' });

  test('the day still rolls over on Vietnam time', async ({ page }) => {
    await seed(page, { day: vietnamDayKey(), usedMs: QUOTA_MS });
    await page.goto('/index.html');

    // Today in Vietnam, so the budget is spent — even though it is still
    // yesterday in New York.
    await expect(page.locator('#timeup')).toBeVisible();
  });
});

test('when the budget is spent it says so and nothing plays', async ({ page }) => {
  await seed(page, { day: vietnamDayKey(), usedMs: QUOTA_MS });
  await page.goto('/index.html');

  await expect(page.locator('#timeup')).toBeVisible();
  await expect(page.locator('#timeup')).toContainText('Đã xem hết giờ hôm nay');

  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeHidden();

  const covers = await page.evaluate(() => {
    const r = document.getElementById('timeup').getBoundingClientRect();
    return r.width >= window.innerWidth && r.height >= window.innerHeight;
  });
  expect(covers).toBe(true);

  await page.screenshot({ path: 'test-results/time-up.png' });
});

test('midnight gives the time back without a restart', async ({ page }) => {
  // A child who runs out at 23:58 should not be stuck on the out-of-time screen
  // until someone thinks to restart the app.
  await seed(page, { day: vietnamDayKey(), usedMs: QUOTA_MS });
  await page.goto('/index.html');
  await expect(page.locator('#timeup')).toBeVisible();

  // Roll the stored day back; the next tick should notice.
  await page.evaluate(
    ([key, day]) => localStorage.setItem(key, JSON.stringify({ day, usedMs: 0 })),
    [QUOTA_KEY, 'rolled-over']
  );

  await expect(page.locator('#timeup')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#clock')).toBeVisible();
});

test('the countdown stays visible over the player', async ({ page }) => {
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

test('a video already playing is stopped when time runs out', async ({ page }) => {
  await seed(page, { day: vietnamDayKey(), usedMs: QUOTA_MS - 1500 });
  await stubSheet(page);
  await page.goto('/index.html');
  await expect(page.locator('.row:not(.loading)').first()).toBeVisible({ timeout: 90_000 });

  await page.keyboard.press('Enter');
  await expect(page.locator('#timeup')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#stage')).toBeHidden();
});
