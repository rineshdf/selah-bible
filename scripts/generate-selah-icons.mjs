/**
 * Selah Bible icon generator.
 *
 * Renders the app icon set (legacy icon, Android adaptive foreground /
 * background / monochrome, favicon, splash) from a single Selah-theme SVG
 * motif — navy open book + gold bookmark + gold radiance — matching the
 * in-app `SelahAppIconSvg` component.
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

// Selah palette (from src/constants/colors.ts + SelahAppIconSvg)
const NAVY = '#26324A';
const NAVY_DEEP = '#1B2437';
const GOLD = '#E8BD72';
const GOLD_DEEP = '#D5A94F';
const CREAM = '#F6EBD4';

/** Open-book glyph path (viewBox 0 0 48 48, scaled via transform). */
const BOOK_PATH =
  'M24 19c-5.4-3.5-11-4-17-1.7v20c6-2.3 11.6-1.8 17 1.7 5.4-3.5 11-4 17-1.7v-20C35 15 29.4 15.5 24 19Z';

function motif({ stroke, strokeScale = 1, bookmark = true, rays = true }) {
  // viewBox-space (0..48) group; scale to the canvas outside.
  return `
    <g transform="translate(0,${rays ? 4.5 : 0})">
      ${rays
        ? `<g stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round" fill="none" transform="translate(0,0)">
             <path d="M24 3.5v4" /> <path d="M16.5 7l2.2 3" /> <path d="M31.5 7l-2.2 3" />
             <path d="M19 12.5l-2.4 1" /> <path d="M29 12.5l2.4 1" />
           </g>
           <circle cx="24" cy="11" r="1.4" fill="${GOLD}" />`
        : ''}
      <path d="M31 15.5V30l3-2.2 3 2.2V14.9c-1.9-.2-4 0-6 .6Z" fill="${GOLD}" />
      <path d="M31 15.5V30l3-2.2 3 2.2V14.9c-1.9-.2-4 0-6 .6Z" fill="none" stroke="${GOLD_DEEP}" stroke-width="0.8" />
      <g stroke="${stroke}" stroke-width="${2.2 * strokeScale}" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="${BOOK_PATH}" />
        <path d="M24 19v20" />
      </g>
    </g>`;
}

function share(svgBody, size, background = 'none') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  ${background !== 'none' ? `<rect width="512" height="512" fill="${background}" />` : ''}
  ${svgBody}
</svg>`;
}

/** Scale helper: place the 48-unit motif inside a 512 canvas with padding. */
function placedMotif(inner, scale = 8.6) {
  return `<g transform="translate(${256 - 24 * scale} ${256 - 24 * scale}) scale(${scale})">${inner}</g>`;
}

const png = (svg) => new Resvg(svg, { fitTo: { mode: 'width', value: 1024 }, font: { loadSystemFonts: false } }).render().asPng();

// 1. Legacy / store icon: full-bleed navy, motif centered, subtle deep vignette.
const legacyBody = `
  <defs>
    <radialGradient id="glow" cx="50%" cy="38%" r="72%">
      <stop offset="0%" stop-color="#33415F" />
      <stop offset="55%" stop-color="${NAVY}" />
      <stop offset="100%" stop-color="${NAVY_DEEP}" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#glow)" />
  ${placedMotif(motif({ stroke: CREAM, strokeScale: 1.15 }), 8.2)}
`;
writeFileSync(join(assetsDir, 'icon.png'), Buffer.from(png(share(legacyBody, 1024))));

// 2. Android adaptive FOREGROUND: transparent, glyph inside the safe zone.
const fgBody = `${placedMotif(motif({ stroke: CREAM, strokeScale: 1.1, rays: false }), 7.4)}`;
writeFileSync(join(assetsDir, 'android-icon-foreground.png'), Buffer.from(png(share(fgBody, 1024))));

// 3. Android adaptive BACKGROUND: soft navy radial glow (full 1024 bleed).
const bgBody = `
  <defs>
    <radialGradient id="bglow" cx="50%" cy="40%" r="75%">
      <stop offset="0%" stop-color="#34425F" />
      <stop offset="60%" stop-color="${NAVY}" />
      <stop offset="100%" stop-color="${NAVY_DEEP}" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bglow)" />
`;
writeFileSync(join(assetsDir, 'android-icon-background.png'), Buffer.from(png(share(bgBody, 1024))));

// 4. Android adaptive MONOCHROME: pure white glyph on transparent.
const monoBody = `${placedMotif(motif({ stroke: '#FFFFFF', bookmark: false, rays: false }), 7.4)}`;
writeFileSync(join(assetsDir, 'android-icon-monochrome.png'), Buffer.from(png(share(monoBody, 1024))));

const faviconBody = `<rect width="512" height="512" rx="96" fill="${NAVY}" />${placedMotif(motif({ stroke: CREAM, strokeScale: 1.15 }), 8.2)}`;
writeFileSync(join(assetsDir, 'favicon.png'), Buffer.from(new Resvg(share(faviconBody, 48), { fitTo: { mode: 'width', value: 48 }, font: { loadSystemFonts: false } }).render().asPng()));

// 5. Splash glyph: navy glyph on transparent (splash background stays #E6F4FE).
const splashBody = `${placedMotif(motif({ stroke: NAVY, strokeScale: 1.1 }), 8.6)}`;
writeFileSync(join(assetsDir, 'splash-icon.png'), Buffer.from(png(share(splashBody, 1024))));

mkdirSync(join(assetsDir, 'images'), { recursive: true });
// Keep a master copy of the design source for future regeneration.
writeFileSync(
  join(assetsDir, 'images', 'selah-bible-icon.svg'),
  share(legacyBody, 1024),
  'utf8',
);

console.log('Selah icons generated into assets/');
