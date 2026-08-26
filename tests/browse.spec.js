const { test, expect } = require('@playwright/test');

/**
 * The browse screen: one horizontally scrolling row per channel, driven entirely
 * by the four arrow keys and Enter, because that is all a TV remote offers.
 */

// Loading is sequential — a single hidden player is re-pointed at each channel's
// uploads playlist in turn — so give the whole screen room to settle.
test.setTimeout(120_000);

test.use({ viewport: { width: 1920, height: 1080 } });

test('renders one row per channel in the Sheet', async ({ page }) => {
  await page.goto('/index.html');

  // Four channels are listed in the Sheet; the last row arriving means the
  // whole sequential load finished.
  await expect(page.locator('.row')).toHaveCount(4, { timeout: 90_000 });

  const names = await page.locator('.row h2').allTextContents();
  expect(names.join(' | ')).toContain('Lingokids');
  expect(names.join(' | ')).toContain('SciShow Kids');

  // Every row must carry real cards, not an empty strip.
  for (const row of await page.locator('.row').all()) {
    expect(await row.locator('.card').count()).toBeGreaterThan(5);
  }

  await expect(page.locator('#status')).toHaveText('');
  await page.screenshot({ path: 'test-results/browse.png', fullPage: false });
});

test('each row really holds the channel it is labelled with', async ({ page }) => {
  // Regression guard. Reading every channel through one shared player and
  // re-pointing it with cuePlaylist() returned the PREVIOUS channel's list for a
  // full cycle: rows shifted by one and a channel silently vanished. On a
  // parental-control screen a row can never show a channel other than the one
  // named on it, so this asserts the pairing rather than just the row count.
  await page.goto('/index.html');
  await expect(page.locator('.row')).toHaveCount(4, { timeout: 90_000 });

  const pairs = await page.evaluate(async () => {
    const out = [];
    for (const row of document.querySelectorAll('.row')) {
      const id = row.querySelector('.card img').src.match(/\/vi\/([\w-]{11})\//)[1];
      const meta = await fetch(
        'https://www.youtube.com/oembed?format=json&url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=' + id)
      ).then((r) => r.json());
      out.push({ label: row.querySelector('h2').textContent.trim(), owner: meta.author_name.trim() });
    }
    return out;
  });

  expect(pairs).toHaveLength(4);
  for (const { label, owner } of pairs) expect(label).toBe(owner);
});

test('captions are trimmed to two lines and never spill out of their card', async ({ page }) => {
  // -webkit-line-clamp silently does nothing here — Chromium computes the
  // caption's display as flow-root — so the two-line limit is enforced by an
  // exact content height instead, with the spacing as margin. Bottom padding
  // would let a third line paint inside it and show as a sliced strip.
  await page.goto('/index.html');
  await expect(page.locator('.row')).toHaveCount(4, { timeout: 90_000 });

  const spilling = await page.evaluate(() =>
    [...document.querySelectorAll('.card')].filter((card) => {
      const cap = card.querySelector('.cap');
      return cap.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom + 0.5;
    }).length
  );
  expect(spilling).toBe(0);
});

test('arrow keys move focus across and between rows', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.row')).toHaveCount(4, { timeout: 90_000 });

  // Focus starts on the first card of the first row.
  await expect(page.locator('.row').nth(0).locator('.card').nth(0)).toHaveClass(/focused/);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.row').nth(0).locator('.card').nth(1)).toHaveClass(/focused/);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.row').nth(1).locator('.card').nth(1)).toHaveClass(/focused/);

  // Left at the start of a row must not wrap to the previous row.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.row').nth(1).locator('.card').nth(0)).toHaveClass(/focused/);
});

test('Enter opens the player and Back returns to the grid', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.row')).toHaveCount(4, { timeout: 90_000 });

  await expect(page.locator('#stage')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#stage iframe')).toBeVisible();
  await page.screenshot({ path: 'test-results/playing.png' });

  // 10009 is the Samsung remote's Back key; Escape is the desk equivalent.
  await page.keyboard.press('Escape');
  await expect(page.locator('#stage')).toBeHidden();
});
