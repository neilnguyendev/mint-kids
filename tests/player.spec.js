const { test, expect } = require('@playwright/test');
const { stubSheet } = require('./helpers');

/**
 * The player screen has two modes, and the arrow keys mean different things in
 * each: watching, where left and right scrub inside the current video, and the
 * grid pulled up over the video, where they move between cards. This mirrors the
 * YouTube TV app, which is the remote vocabulary the household already knows.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const overVideo = (page) => page.evaluate(() => document.getElementById('app').classList.contains('over-video'));

/** Open the grid, start the first video, and wait for the player to be usable. */
async function startWatching(page) {
  await stubSheet(page);
  await page.goto('/index.html');
  await expect(page.locator('.row:not(.loading)').first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#stage iframe')).toBeVisible();
  // The player object gains its methods only once the iframe has loaded.
  await page.waitForTimeout(3500);
}

test('down pulls the grid up over the playing video', async ({ page }) => {
  await startWatching(page);
  expect(await overVideo(page)).toBe(false);

  await page.keyboard.press('ArrowDown');
  expect(await overVideo(page)).toBe(true);

  // The video is still there and still playing behind the rows — this is a
  // layer over the video, not a trip back to the grid.
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#rows')).toBeVisible();
  await expect(page.locator('#top')).toBeHidden();

  await page.screenshot({ path: 'test-results/over-video.png' });
});

test('the grid over the video starts on whatever is playing', async ({ page }) => {
  // Landing anywhere else would make the child hunt for where they were.
  await startWatching(page);
  await page.keyboard.press('ArrowRight');   // seek, must not move the highlight
  await page.keyboard.press('ArrowDown');

  await expect(
    page.locator('.row:not(.loading)').nth(0).locator('.card').nth(0)
  ).toHaveClass(/focused/);
});

test('up from the top row goes back to the video', async ({ page }) => {
  await startWatching(page);
  await page.keyboard.press('ArrowDown');
  expect(await overVideo(page)).toBe(true);

  await page.keyboard.press('ArrowUp');
  expect(await overVideo(page)).toBe(false);
  await expect(page.locator('#stage')).toBeVisible();
});

test('back closes the grid without leaving the video', async ({ page }) => {
  await startWatching(page);
  await page.keyboard.press('ArrowDown');

  await page.keyboard.press('Escape');
  expect(await overVideo(page)).toBe(false);
  await expect(page.locator('#stage')).toBeVisible();

  // A second press is the one that actually leaves.
  await page.keyboard.press('Escape');
  await expect(page.locator('#stage')).toBeHidden();
});

test('left and right scrub the video instead of changing it', async ({ page }) => {
  // Skipping tracks on a stray press is how a child loses the thing they were
  // watching, so the horizontal keys stay inside the current video.
  await startWatching(page);
  const playingBefore = await page.locator('#nowplaying').textContent();

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#seekhint')).toBeVisible();
  const forward = await page.locator('#seekhint').textContent();
  expect(forward).toContain('▶▶');

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#seekhint')).toContainText('◀◀');

  // Same video throughout, and the grid was never opened.
  expect(await page.locator('#nowplaying').textContent()).toBe(playingBefore);
  expect(await overVideo(page)).toBe(false);
});

test('the seek readout appears and then gets out of the way', async ({ page }) => {
  // controls:0 means there is no scrubber, so this readout is the only feedback
  // a seek produces — but it must not sit on the picture indefinitely.
  await startWatching(page);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#seekhint')).toBeVisible();
  await expect(page.locator('#seekhint')).toContainText(/\d+:\d\d/);
  await expect(page.locator('#seekhint')).toBeHidden({ timeout: 8000 });
});

test('picking a card in the grid over the video switches to it', async ({ page }) => {
  await startWatching(page);
  const before = await page.locator('#nowplaying').textContent();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  // The grid steps aside and the player stays open on the new video.
  expect(await overVideo(page)).toBe(false);
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#nowplaying')).not.toHaveText(before);
});

test('the countdown stays on top of the grid over the video', async ({ page }) => {
  await startWatching(page);
  await page.keyboard.press('ArrowDown');

  await expect(page.locator('#clock')).toBeVisible();
  const [clockZ, rowsZ] = await page.evaluate(() => [
    +getComputedStyle(document.getElementById('clock')).zIndex,
    +getComputedStyle(document.getElementById('rows')).zIndex,
  ]);
  expect(clockZ).toBeGreaterThan(rowsZ);
});
