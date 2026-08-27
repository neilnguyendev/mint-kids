const { test, expect } = require('@playwright/test');
const { clockSeconds, stubSheetCsv, seedOutOfTime } = require('./helpers');

/**
 * The countdown badge is a focus stop. Pressing up from the top row of the grid,
 * or from a playing video, lands on it; OK there opens the PIN screen so a
 * parent can hand back the day without waiting for it to run out.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const CHANNELS = [
  'https://www.youtube.com/@Numberblocks',
  'https://www.youtube.com/@SciShowKids',
];

const withPin = (minutes = 9) =>
  'YouTube channel,Số phút tối đa / ngày,Mật khẩu để reset số phút (4 số)\n' +
  `${CHANNELS[0]},${minutes},1234\n` +
  `${CHANNELS[1]},,\n`;

const withoutPin = () =>
  'YouTube channel,Số phút tối đa / ngày\n' +
  `${CHANNELS[0]},9\n` +
  `${CHANNELS[1]},\n`;

const badgeFocused = (page) =>
  page.evaluate(() => document.getElementById('clock').classList.contains('focused'));

async function openGrid(page, csv = withPin()) {
  await stubSheetCsv(page, csv);
  await page.goto('/index.html');
  await expect(page.locator('.row:not(.loading)')).toHaveCount(2, { timeout: 90_000 });
  await page.waitForTimeout(1500);
}

test('up from the top row moves onto the badge, and down comes back', async ({ page }) => {
  await openGrid(page);
  await expect(page.locator('.card.focused')).toHaveCount(1);

  await page.keyboard.press('ArrowUp');
  expect(await badgeFocused(page)).toBe(true);
  // The highlight is in one place at a time.
  await expect(page.locator('.card.focused')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/badge-focus.png' });

  await page.keyboard.press('ArrowDown');
  expect(await badgeFocused(page)).toBe(false);
  await expect(page.locator('.card.focused')).toHaveCount(1);
});

test('up from a lower row is ordinary navigation, not a jump to the badge', async ({ page }) => {
  await openGrid(page);
  await page.keyboard.press('ArrowDown');            // second row
  await page.keyboard.press('ArrowUp');              // back to the first

  expect(await badgeFocused(page)).toBe(false);
  await expect(page.locator('.row:not(.loading)').nth(0).locator('.card').nth(0)).toHaveClass(/focused/);
});

test('OK on the badge opens the reset, and Back changes nothing', async ({ page }) => {
  await openGrid(page);
  const before = await clockSeconds(page);

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('#timeup')).toBeVisible();
  await expect(page.locator('#timeup .big')).toHaveText('Đặt lại thời gian');
  await expect(page.locator('#pinbox')).toBeVisible();
  await page.screenshot({ path: 'test-results/pin-reset.png' });

  await page.keyboard.press('Escape');
  await expect(page.locator('#timeup')).toBeHidden();
  // Cancelling is not a reset: the countdown carries on from where it was.
  expect(await clockSeconds(page)).toBeLessThanOrEqual(before);
});

test('the right code from the badge hands the day back', async ({ page }) => {
  await openGrid(page, withPin(9));
  await page.waitForTimeout(3000);                   // let some time be spent
  const before = await clockSeconds(page);

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  for (const d of '1234') await page.keyboard.press(`Digit${d}`);

  await expect(page.locator('#timeup')).toBeHidden();
  expect(await clockSeconds(page)).toBeGreaterThan(before);
  await expect(page.locator('.card.focused')).toHaveCount(1);   // back on the grid
});

test('the badge is reachable from a playing video, which keeps playing', async ({ page }) => {
  await openGrid(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeVisible();
  await page.waitForTimeout(3000);

  await page.keyboard.press('ArrowUp');
  expect(await badgeFocused(page)).toBe(true);
  await expect(page.locator('#stage')).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#timeup')).toBeVisible();
  for (const d of '1234') await page.keyboard.press(`Digit${d}`);

  // Time restored and the video is still there — the parent topped it up
  // without interrupting what was on.
  await expect(page.locator('#timeup')).toBeHidden();
  await expect(page.locator('#stage')).toBeVisible();
});

test('without a PIN the badge is not a focus stop at all', async ({ page }) => {
  // Landing on it would be a dead end: resetting the day is all it offers.
  await openGrid(page, withoutPin());

  await page.keyboard.press('ArrowUp');
  expect(await badgeFocused(page)).toBe(false);
  await expect(page.locator('.card.focused')).toHaveCount(1);
});

test('running out of time is not something Back can dismiss', async ({ page }) => {
  // The reset a parent opens is cancellable; the wall at the end of the day is
  // not, or the whole limit is one button press away from meaningless.
  await seedOutOfTime(page);
  await openGrid(page);
  await expect(page.locator('#timeup')).toBeVisible();
  await expect(page.locator('#timeup .big')).toHaveText('Đã xem hết giờ hôm nay');

  await page.keyboard.press('Escape');
  await expect(page.locator('#timeup')).toBeVisible();
});
