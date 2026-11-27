// 앱 아이콘 PNG 생성: node scripts/make-icons.mjs  (필요: playwright — npm i --no-save playwright)
// 임시(placeholder) 디자인: 보라 그라데이션 + 흰 알약 + 체크. 최종 아이콘이 정해지면 SVG 만 바꿔 다시 실행한다.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');

const defs = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D28D9"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs>`;
const bg = '<rect width="1024" height="1024" fill="url(#bg)"/>';
// 알약(캡슐) + 체크
const pill = (fill = '#fff', ink = '#6D28D9') => `<g transform="rotate(-35 512 512)">
  <rect x="222" y="372" width="580" height="280" rx="140" fill="${fill}"/>
  <path d="M512 372h162a140 140 0 0 1 0 280H512z" fill="${ink}" opacity=".18"/></g>
  <circle cx="676" cy="690" r="118" fill="${ink}"/><path d="M620 690l42 44 78-88" fill="none" stroke="${fill}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (size, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}${inner}</svg>`;
const fit = (inner) => `<g transform="translate(512 512) scale(.8) translate(-512 -512)">${inner}</g>`;

const files = {
  'icon.png': { size: 1024, svg: svg(1024, bg + pill()), opaque: true },
  'android-icon-background.png': { size: 1024, svg: svg(1024, bg), opaque: true },
  'android-icon-foreground.png': { size: 1024, svg: svg(1024, fit(pill())) },
  'android-icon-monochrome.png': { size: 1024, svg: svg(1024, fit(pill('#000', '#fff'))) },
  'splash-icon.png': { size: 512, svg: svg(512, pill()) },
  'favicon.png': { size: 48, svg: svg(48, bg + pill()), opaque: true },
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, f] of Object.entries(files)) {
  await page.setViewportSize({ width: f.size, height: f.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${f.svg}</body></html>`);
  fs.writeFileSync(path.join(OUT, name), await page.screenshot({ omitBackground: !f.opaque, clip: { x: 0, y: 0, width: f.size, height: f.size } }));
  console.log('wrote', name);
}
await browser.close();
