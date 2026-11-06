/**
 * Selah Bible icon generator (sunburst edition).
 *
 * Renders the app icon set (assets/images/icon.png, adaptive-icon.png,
 * splash-icon.png, adaptive monochrome, favicon) from the symmetrical
 * sunburst open-Bible motif that matches the in-app `SelahAppIconSvg`
 * component (viewBox 0 0 24 24): blue open pages #7C9BFF, golden ribbon
 * #F5C469 and a five-ray sun crown, on a deep midnight #0F172A background.
 *
 * All full-bleed art keeps the motif inside the centre 62% Android adaptive
 * safe zone of the 1024 canvas (x/y 194..830).
 *
 * Usage: node scripts/generate-selah-icons.mjs
 * Requires @resvg/resvg-js (installed ad hoc with `--no-save`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(repoRoot, 'assets');
const imagesDir = join(assetsDir, 'images');

// Selah palette (app icon edition, from src/constants/colors.ts + SelahAppIconSvg)
const BG = '#0F172A';
const GLOW = '#1C2A4F';
const PAGE_BLUE = '#7C9BFF';
const PAGE_BLUE_DEEP = '#5E7EF0';
const GOLD = '#F5C469';
const GOLD_DEEP = '#DDA84E';

// Master motif paths (viewBox 0 0 24 24 — identical to SelahAppIconSvg.tsx).
const LEFT_PAGE = 'M12 7.5 C9.5 6.2 6.2 6.2 3.5 7.2 V18.5 C6.2 17.5 9.5 17.5 12 18.8 Z';
const RIGHT_PAGE = 'M12 7.5 C14.5 6.2 17.8 6.2 20.5 7.2 V18.5 C17.8 17.5 14.5 17.5 12 18.8 Z';
const SPINE = 'M12 7.5 V18.8';
const RIBBON = 'M15.2 6.7 H17.6 V15.2 L16.4 13.8 L15.2 15.2 Z';
const RAYS = [
  'M12 3.3 V1.6',
  'M10.4 3.8 L9.3 2.4',
  'M13.6 3.8 L14.7 2.4',
  'M9.4 5.1 L7.8 4.5',
  'M14.6 5.1 L16.2 4.5',
];

/**
 * Motif group in 24-unit space. Options:
 *  - outline: stroke the pages/ribbon in white instead of filling (monochrome).
 *  - rays: include the sun crown.
 */
function motif({ outline = false, rays = true } = {}) {
  const pageArt = outline
    ? `<path d="${LEFT_PAGE}" fill="none" stroke="#FFFFFF" stroke-width="0.9" stroke-linejoin="round" />
       <path d="${RIGHT_PAGE}" fill="none" stroke="#FFFFFF" stroke-width="0.9" stroke-linejoin="round" />
       <path d="${SPINE}" stroke="#FFFFFF" stroke-width="0.9" stroke-linecap="round" />
       <path d="${RIBBON}" fill="none" stroke="#FFFFFF" stroke-width="0.9" stroke-linejoin="round" />`
    : `<path d="${LEFT_PAGE}" fill="${PAGE_BLUE}" />
       <path d="${RIGHT_PAGE}" fill="${PAGE_BLUE}" />
       <path d="${SPINE}" stroke="${PAGE_BLUE_DEEP}" stroke-width="0.9" stroke-linecap="round" />
       <path d="${RIBBON}" fill="${GOLD}" />
       <path d="${RIBBON}" fill="none" stroke="${GOLD_DEEP}" stroke-width="0.22" stroke-linejoin="round" />`;

  const rayArt = rays
    ? `<g stroke="${outline ? '#FFFFFF' : GOLD}" stroke-width="1.1" stroke-linecap="round" fill="none">
         ${RAYS.map((d) => `<path d="${d}" />`).join('  ')}
       </g>
       <circle cx="12" cy="5.0" r="0.95" fill="${outline ? '#FFFFFF' : GOLD}" />`
    : '';

  return `${rayArt}
    ${pageArt}`;
}

/**
 * Scale the 24-unit motif onto the 512-unit canvas so that the artwork
 * bounding box (x 3.5..20.5, y 1.6..18.8) sits inside the centre 62%
 * Android adaptive safe zone (x/y 194..830 of 1024 => 97..415 of 512).
 */
function placedMotif(inner) {
  const safeZone = 512 * 0.62; // 317.44 units
  const scale = safeZone / 17.2; // motif height in 24-unit space
  const tx = 256 - 12 * scale; // motif bbox x centre = 12
  const ty = 256 - 10.2 * scale; // motif bbox y centre = (1.6 + 18.8) / 2
  return `<g transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)}) scale(${scale.toFixed(4)})">${inner}</g>`;
}

function share(svgBody, { background = 'none', glow = false } = {}) {
  const defs = glow
    ? `<defs>
    <radialGradient id="glow" cx="50%" cy="40%" r="78%">
      <stop offset="0%" stop-color="${GLOW}" />
      <stop offset="62%" stop-color="${BG}" />
      <stop offset="100%" stop-color="${BG}" />
    </radialGradient>
  </defs>`
    : '';
  const rect =
    background === 'none' && !glow ? '' : `<rect width="512" height="512" fill="${glow ? 'url(#glow)' : background}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${defs}
  ${rect}
  ${svgBody}
</svg>`;
}

const render1024 = (svg) =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1024 }, font: { loadSystemFonts: false } }).render().asPng());

mkdirSync(imagesDir, { recursive: true });

// 1. Store icon — full-bleed midnight, sunburst Bible centered in the safe zone.
writeFileSync(join(imagesDir, 'icon.png'), render1024(share(placedMotif(motif()), { glow: true })));

// 2. Android adaptive foreground — artwork inside the centre 62% safe zone
//    on the solid adaptive background colour.
writeFileSync(join(imagesDir, 'adaptive-icon.png'), render1024(share(placedMotif(motif()), { background: BG })));

// 3. Splash — the launch art on the matching midnight background.
writeFileSync(join(imagesDir, 'splash-icon.png'), render1024(share(placedMotif(motif()), { background: BG })));

// 4. Android adaptive MONOCHROME — white glyph on transparent.
writeFileSync(
  join(imagesDir, 'adaptive-icon-monochrome.png'),
  render1024(share(placedMotif(motif({ outline: true, rays: true }))))
);

// 5. Favicon — rounded midnight tile with the motif.
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${BG}" />
  ${placedMotif(motif())}
</svg>`;
writeFileSync(
  join(assetsDir, 'favicon.png'),
  Buffer.from(
    new Resvg(faviconSvg, { fitTo: { mode: 'width', value: 48 }, font: { loadSystemFonts: false } }).render().asPng()
  )
);

// Authoritative design source kept next to the PNGs for future regeneration.
writeFileSync(join(imagesDir, 'selah-bible-icon.svg'), share(placedMotif(motif()), { glow: true }), 'utf8');

console.log('Selah sunburst icons generated into assets/images/');
