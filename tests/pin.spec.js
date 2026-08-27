const { test, expect } = require('@playwright/test');
const { clockSeconds, stubSheetCsv, seedOutOfTime } = require('./helpers');

/**
 * The daily allowance and the parent's PIN both come from the Sheet, so a parent
 * changes them by editing a spreadsheet rather than by editing code. The PIN is
 * the only way past the out-of-time screen, and it is typed on an on-screen
 * keypad because a TV remote has no keyboard — and the current ones no number
 * buttons either.
 */

test.setTimeout(120_000);
test.use({ viewport: { width: 1920, height: 1080 } });

const sheet = (rows) => 'YouTube channel,Cài đặt,Giá trị\n' + rows.join('\n') + '\n';
const CHANNEL = 'https://www.youtube.com/@Numberblocks';

test('the daily allowance comes from the Sheet', async ({ page }) => {
  await stubSheetCsv(page, sheet([`${CHANNEL},số phút,7`]));
  await page.goto('/index.html');

  // The countdown starts on the built-in default and adopts the Sheet's value
  // when it arrives; 7 minutes, not the 2 compiled in.
  await expect.poll(() => clockSeconds(page), { timeout: 30_000 }).toBeGreaterThan(6 * 60);
});

test('settings can be column headings with the values underneath', async ({ page }) => {
  // The layout a person actually reaches for in a spreadsheet, and the exact
  // headings this Sheet uses. The first attempt only read a key beside its
  // value, so a real sheet configured this way silently had no PIN at all.
  await stubSheetCsv(
    page,
    'YouTube channel,Số phút tối đa / ngày,Mật khẩu để reset số phút (4 số)\n' +
      `${CHANNEL},8,4271\n` +
      'https://www.youtube.com/@SciShowKids,,\n'
  );
  await seedOutOfTime(page);
  await page.goto('/index.html');

  await expect(page.locator('#resetbtn')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pinbox')).toBeVisible();

  for (const d of '4271') await page.keyboard.press(`Digit${d}`);
  await expect(page.locator('#timeup')).toBeHidden();
  expect(await clockSeconds(page)).toBeGreaterThan(7 * 60);
});

test('a heading naming both settings is read as the more specific one', async ({ page }) => {
  // "Mật khẩu để reset số phút" mentions minutes as well as the password.
  // Reading it as the allowance would set the budget from a PIN.
  await stubSheetCsv(
    page,
    'YouTube channel,Mật khẩu để reset số phút (4 số),Số phút tối đa / ngày\n' +
      `${CHANNEL},4271,8\n`
  );
  await page.goto('/index.html');

  await expect.poll(() => clockSeconds(page), { timeout: 30_000 }).toBeGreaterThan(7 * 60);
});

test('the key can be written the way a parent would type it', async ({ page }) => {
  // Accents, spacing and case are all folded away, so "Số phút" and "so phut"
  // and "minutes" mean the same thing.
  await stubSheetCsv(page, sheet([`${CHANNEL},MINUTES,9`]));
  await page.goto('/index.html');
  await expect.poll(() => clockSeconds(page), { timeout: 30_000 }).toBeGreaterThan(8 * 60);
});

test('with no PIN in the Sheet there is no keypad to press', async ({ page }) => {
  // An empty keypad inviting presses that can never work is worse than none.
  await seedOutOfTime(page);
  await stubSheetCsv(page, sheet([`${CHANNEL},số phút,5`]));
  await page.goto('/index.html');

  await expect(page.locator('#timeup')).toBeVisible();
  await expect(page.locator('#pinbox')).toBeHidden();
});

test.describe('with a PIN set in the Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await seedOutOfTime(page);
    await stubSheetCsv(page, sheet([`${CHANNEL},số phút,6`, `,mật khẩu,4271`]));
    await page.goto('/index.html');
    await expect(page.locator('#timeup')).toBeVisible();
    // The keypad is behind a button now; these tests are about the keypad.
    await expect(page.locator('#resetbtn')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#pinbox')).toBeVisible();
  });

  test('the keypad is behind a button, not sitting there to be tried', async ({ page }) => {
    // Fresh screen: the child is meant to read the message, not find a keypad
    // inviting them to guess codes.
    await page.reload();
    await expect(page.locator('#timeup')).toBeVisible();
    await expect(page.locator('#resetbtn')).toHaveText('Đặt lại thời gian');
    await expect(page.locator('#resetbtn')).toHaveClass(/focused/);
    await expect(page.locator('#pinbox')).toBeHidden();
    await page.screenshot({ path: 'test-results/timeup-button.png' });

    await page.keyboard.press('Enter');
    await expect(page.locator('#pinbox')).toBeVisible();
    await expect(page.locator('#resetbtn')).toBeHidden();
  });

  test('Back leaves the keypad but not the screen', async ({ page }) => {
    // Running out of time still is not dismissible; Back only undoes the step
    // that opened the keypad.
    await page.keyboard.press('Escape');
    await expect(page.locator('#resetbtn')).toBeVisible();
    await expect(page.locator('#pinbox')).toBeHidden();
    await expect(page.locator('#timeup')).toBeVisible();
  });

  test('four boxes wait for four digits, and they are masked', async ({ page }) => {
    await expect(page.locator('.pin-cells span')).toHaveCount(4);
    await expect(page.locator('.pin-cells span').nth(0)).toHaveClass(/active/);

    await page.keyboard.press('Digit4');
    // Masked: a child watching over a shoulder should not learn the code.
    await expect(page.locator('.pin-cells span').nth(0)).toHaveText('•');
    await expect(page.locator('.pin-cells span').nth(0)).toHaveClass(/filled/);
    // Entry moved on by itself.
    await expect(page.locator('.pin-cells span').nth(1)).toHaveClass(/active/);
  });

  test('the wrong code is refused and the screen stays shut', async ({ page }) => {
    for (const d of '1111') await page.keyboard.press(`Digit${d}`);

    await expect(page.locator('.pin-error')).toContainText('Mật khẩu không đúng');
    await expect(page.locator('#timeup')).toBeVisible();
    // Boxes cleared, ready for another go rather than stuck full.
    await expect(page.locator('.pin-cells span.filled')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/pin-wrong.png' });
  });

  test('the right code hands the day back', async ({ page }) => {
    for (const d of '4271') await page.keyboard.press(`Digit${d}`);

    await expect(page.locator('#timeup')).toBeHidden();
    // The full allowance from the Sheet, not the compiled-in default.
    expect(await clockSeconds(page)).toBeGreaterThan(5 * 60);
  });

  test('the fourth digit submits on its own', async ({ page }) => {
    for (const d of '427') await page.keyboard.press(`Digit${d}`);
    await expect(page.locator('#timeup')).toBeVisible();      // nothing yet

    await page.keyboard.press('Digit1');
    await expect(page.locator('#timeup')).toBeHidden();       // no confirm key
  });

  test('the keypad is usable with only the arrows and OK', async ({ page }) => {
    // The remote has no number buttons, so walking the grid must work on its own.
    await expect(page.locator('.key.focused')).toHaveText('1');

    const press = async (moves) => {
      for (const m of moves) await page.keyboard.press(m);
      await page.keyboard.press('Enter');
    };
    await press(['ArrowDown', 'ArrowRight']);              // 1 -> 4 -> 5
    await expect(page.locator('.pin-cells span.filled')).toHaveCount(1);
  });

  test('backspace takes a digit back', async ({ page }) => {
    await page.keyboard.press('Digit4');
    await page.keyboard.press('Digit2');
    await expect(page.locator('.pin-cells span.filled')).toHaveCount(2);

    await page.keyboard.press('Backspace');
    await expect(page.locator('.pin-cells span.filled')).toHaveCount(1);
  });

  test('nothing plays while the screen is up', async ({ page }) => {
    await page.keyboard.press('Enter');          // presses a keypad key, not a video
    await expect(page.locator('#stage')).toBeHidden();
  });
});
