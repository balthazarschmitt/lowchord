// Renders the app icons with headless Chromium: node tools/icons.mjs
import { chromium } from 'playwright';

const html = (size, maskable) => `<canvas id=c width=${size} height=${size}></canvas><script>{
const c = document.getElementById('c'), g = c.getContext('2d'), s = ${size};
g.fillStyle = '#0b0d10'; g.fillRect(0, 0, s, s);
const inset = ${maskable} ? s * 0.18 : s * 0.08, w = s - inset * 2;
// Seven pads in a row
const pw = w / 7.6;
for (let i = 0; i < 7; i++) {
  const x = inset + i * (w / 7) + (w / 7 - pw) / 2, h = w * 0.42, y = inset + w - h;
  g.fillStyle = i === 3 ? '#ffb547' : '#2b313b';
  g.beginPath(); g.roundRect(x, y, pw, h, pw * 0.25); g.fill();
}
// Joystick
g.fillStyle = '#9fe8ff';
g.beginPath(); g.arc(inset + w * 0.5, inset + w * 0.26, w * 0.17, 0, Math.PI * 2); g.fill();
g.fillStyle = '#0b0d10';
g.beginPath(); g.arc(inset + w * 0.5, inset + w * 0.26, w * 0.07, 0, Math.PI * 2); g.fill();
}</script>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('icon script error:', e.message));
for (const [size, name, mask] of [[180, 'icon-180', false], [192, 'icon-192', false], [512, 'icon-512', false], [512, 'icon-maskable-512', true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${html(size, mask)}</body>`);
  await (await page.$('#c')).screenshot({ path: `icons/${name}.png` });
}
await browser.close();
console.log('icons written');
