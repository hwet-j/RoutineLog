// 앱 아이콘 PNG 생성: node scripts/make-icons.mjs  (필요: playwright — npm i --no-save playwright)
// 디자인(R10): 주황→장미 그라데이션 위의 일일 체크 카드(체크 5개 + 남은 한 칸). SVG 만 바꿔 다시 실행한 뒤 assets/*.png 를 커밋한다.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');

const defs = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#F43F5E"/></linearGradient></defs>`;
const bg = '<rect width="1024" height="1024" fill="url(#bg)"/>';
// 카드 안 체크 칸 위치 (3 + 2 완료, 마지막 한 칸은 비어 있음)
const cells = [[330, 520], [512, 520], [694, 520], [330, 690], [512, 690]];
const check = (x, y, s = 1) => `M${x - 24 * s} ${y}l${18 * s} ${20 * s}l${34 * s} ${-40 * s}`;
const card = () => `<rect x="212" y="260" width="600" height="560" rx="76" fill="#fff"/>
  <rect x="212" y="260" width="600" height="150" rx="76" fill="#FFE4E6"/><rect x="212" y="340" width="600" height="70" fill="#FFE4E6"/>
  <rect x="340" y="196" width="40" height="110" rx="20" fill="#9F1239"/><rect x="644" y="196" width="40" height="110" rx="20" fill="#9F1239"/>
  ${cells.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="52" fill="#22C55E"/><path d="${check(x, y)}" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
  <circle cx="694" cy="690" r="52" fill="none" stroke="#FDA4AF" stroke-width="14"/>`;
/** 단색 카드: 윗줄 띠와 체크 칸을 뚫는다 (Android 테마 아이콘·알림 작은 아이콘) */
const monoCard = (color) => `<mask id="m"><rect width="1024" height="1024" fill="#fff"/>
  <rect x="212" y="340" width="600" height="14" fill="#000"/>
  ${cells.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="52" fill="#000"/><path d="${check(x, y)}" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
  <circle cx="694" cy="690" r="52" fill="none" stroke="#000" stroke-width="14"/></mask>
  <rect x="212" y="260" width="600" height="560" rx="76" fill="${color}" mask="url(#m)"/>
  <rect x="340" y="196" width="40" height="110" rx="20" fill="${color}"/><rect x="644" y="196" width="40" height="110" rx="20" fill="${color}"/>`;
const svg = (size, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}${inner}</svg>`;
/** 적응형 아이콘 전경: 안전 영역(가운데 66%)에 맞게 줄인다 */
const fit = (inner, k = 0.86) => `<g transform="translate(512 512) scale(${k}) translate(-512 -508)">${inner}</g>`;

const files = {
  'icon.png': { size: 1024, svg: svg(1024, bg + card()), opaque: true },
  'android-icon-background.png': { size: 1024, svg: svg(1024, bg), opaque: true },
  'android-icon-foreground.png': { size: 1024, svg: svg(1024, fit(card())) },
  'android-icon-monochrome.png': { size: 1024, svg: svg(1024, fit(monoCard('#000'))) },
  'splash-icon.png': { size: 512, svg: svg(512, card()) },
  'favicon.png': { size: 48, svg: svg(48, bg + card()), opaque: true },
  'notification-icon.png': { size: 96, svg: svg(96, fit(monoCard('#fff'), 1.1)) },
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
