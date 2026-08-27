const { chromium } = require('@playwright/test');
const CSV = 'YouTube channel,Số phút tối đa / ngày,Mật khẩu để reset số phút (4 số)\n' +
  'https://www.youtube.com/@Numberblocks,9,1234\n' +
  'https://www.youtube.com/@SciShowKids,,\n';
const focused = p => p.evaluate(() => document.getElementById('clock').classList.contains('focused'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.route('**/docs.google.com/**', r => r.fulfill({ status: 200, contentType: 'text/csv', body: CSV }));
  await p.goto('http://localhost:8080/index.html');
  await p.waitForFunction(() => document.querySelectorAll('.row:not(.loading)').length >= 2, null, { timeout: 60000 });
  await p.waitForTimeout(2500);

  console.log('--- huỷ rồi quay lại lưới ---');
  await p.keyboard.press('ArrowUp');    // badge
  await p.keyboard.press('Enter');      // mở màn mã
  await p.keyboard.press('Escape');     // huỷ
  await p.keyboard.press('ArrowDown');  // rời badge, về lưới
  console.log('  badge focus:', await focused(p),
              '| card focus:', await p.locator('.card.focused').count());

  console.log('--- vào video rồi lên badge ---');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);
  console.log('  stage:', await p.locator('#stage').isVisible());
  await p.keyboard.press('ArrowUp');
  console.log('  Lên -> badge focus:', await focused(p), '| stage vẫn mở:', await p.locator('#stage').isVisible());
  await p.screenshot({ path: 'test-results/badge-over-video.png' });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  console.log('  OK  -> màn mã:', await p.locator('#timeup').isVisible());
  const before = await p.locator('#clock-time').textContent();
  for (const d of '1234') await p.keyboard.press(`Digit${d}`);
  await p.waitForTimeout(600);
  console.log('  nhập 1234 -> màn mã:', await p.locator('#timeup').isVisible(),
              '| đồng hồ:', before, '->', await p.locator('#clock-time').textContent(),
              '| stage vẫn mở:', await p.locator('#stage').isVisible());
  await b.close();
})();
