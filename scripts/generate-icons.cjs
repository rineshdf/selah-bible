/**
 * Rasterizes the canonical Selah Bible app icon (the exact vector design of
 * `src/components/SelahAppIconSvg.tsx`) into every PNG asset the app config
 * references:
 *
 *   assets/images/icon.png                     1024x1024, #0F172A background
 *   assets/images/adaptive-icon.png            1024x1024, #0F172A background
 *   assets/images/splash-icon.png              1024x1024, #0F172A background
 *   assets/images/adaptive-icon-monochrome.png 1024x1024, white on transparent
 *
 * All artwork is kept inside the Android adaptive-icon 62% safe zone
 * (x: 194..830, y: 194..830 at 1024px) so launcher masks never clip the
 * top sun rays.
 *
 * Run after editing the vector design: `node scripts/generate-icons.cjs`
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ---------------------------------------------------------------------------
// Vector design (viewBox 0 0 24 24) — the SelahAppIconSvg mark, verbatim.
// ---------------------------------------------------------------------------

const PAGE_BLUE = [124, 155, 255]; // #7C9BFF
const GOLD = [245, 196, 105]; // #F5C469
const NAVY_BG = [15, 23, 42]; // #0F172A
const WHITE = [255, 255, 255];

function leftPagePolygon() {
  const right = rightPagePolygon();
  return right
    .map(([x, y]) => [24 - x, y])
    .reverse();
}

/** Flattened filled polygon for `M12 7.5 C14.5 6.2 17.8 6.2 20.5 7.2 V18.5 C17.8 17.5 14.5 17.5 12 18.8 Z`. */
function rightPagePolygon() {
  const pts = [[12, 7.5]];
  pts.push(...cubicFlatten(12, 7.5, 14.5, 6.2, 17.8, 6.2, 20.5, 7.2));
  pts.push([20.5, 18.5]); // V18.5 (vertical edge)
  pts.push(...cubicFlatten(20.5, 18.5, 17.8, 17.5, 14.5, 17.5, 12, 18.8));
  pts.push([12, 7.5]); // Z (closes along the spine)
  return pts;
}

function cubicFlatten(x0, y0, c1x, c1y, c2x, c2y, x1, y1) {
  const pts = [];
  for (let i = 1; i <= 48; i += 1) {
    const t = i / 48;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    pts.push([
      a * x0 + b * c1x + c * c2x + d * x1,
      a * y0 + b * c1y + c * c2y + d * y1,
    ]);
  }
  return pts;
}

/** Golden ribbon bookmark polygon: `M15.2 6.7 H17.6 V15.2 L16.4 13.8 L15.2 15.2 Z`. */
const RIBBON_POLYGON = [
  [15.2, 6.7],
  [17.6, 6.7],
  [17.6, 15.2],
  [16.4, 13.8],
  [15.2, 15.2],
];

/** Spine stroke: `M12 7.5 V18.8`, strokeWidth 0.9, round caps. */
const SPINE_SEGMENT = { x1: 12, y1: 7.5, x2: 12, y2: 18.8, r: 0.9 / 2 };

/** Sun dot: `<Circle cx="12" cy="5.0" r="0.95" />`. */
const SUN_DOT = { cx: 12, cy: 5.0, r: 0.95 };

/** Five sunburst rays, strokeWidth 1.1, round caps, mirrored around x = 12. */
const RAY_SEGMENTS = [
  { x1: 12, y1: 3.3, x2: 12, y2: 1.6 }, // 0° center vertical
  { x1: 10.4, y1: 3.8, x2: 9.3, y2: 2.4 }, // -35° inner left
  { x1: 13.6, y1: 3.8, x2: 14.7, y2: 2.4 }, // +35° inner right
  { x1: 9.4, y1: 5.1, x2: 7.8, y2: 4.5 }, // -68° outer left
  { x1: 14.6, y1: 5.1, x2: 16.2, y2: 4.5 }, // +68° outer right
].map((seg) => ({ ...seg, r: 1.1 / 2 }));

// ---------------------------------------------------------------------------
// Rasterization: two coverage masks at 4x supersampling, then box downsample.
//   BLUE mask: open Bible pages + centre spine.
//   GOLD mask: ribbon bookmark + sun rays + sun dot.
// ---------------------------------------------------------------------------

const OUT = 1024;
const SS = 4;
const SUP = OUT * SS; // 4096
// ART placement: art bbox (incl. strokes) spans x 3.5..20.5, y 1.05..19.25 in
// the 24-unit grid. Scale 32 px/unit and center it inside the 62% safe zone.
const SCALE = 32;
const OX = OUT / 2 - 12 * SCALE; // horizontally centred on x = 12
const OY = OUT / 2 - ((1.05 + 19.25) / 2) * SCALE; // vertically centred bbox

function allocMask() {
  return new Uint8Array(SUP * SUP);
}

/** Even-odd scanline polygon fill into `mask` at supersample resolution. */
function fillPolygon(mask, polygon) {
  const toSupX = (x) => x * SCALE * SS + OX * SS;
  const toSupY = (y) => y * SCALE * SS + OY * SS;
  for (let row = 0; row < SUP; row += 1) {
    // Unit-space y of this supersample row's centre.
    const yc = (row + 0.5 - OY * SS) / (SCALE * SS);
    const xs = [];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (a[1] === b[1]) continue;
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        const t = (yc - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel columns whose supersample centre falls inside (xs[k], xs[k+1]).
      const cx0 = xs[k] * SCALE * SS + OX * SS;
      const cx1 = xs[k + 1] * SCALE * SS + OX * SS;
      let col = Math.ceil(cx0 - 0.5);
      const colEnd = Math.floor(cx1 - 0.5);
      col = Math.max(0, col);
      for (; col <= Math.min(SUP - 1, colEnd); col += 1) {
        mask[row * SUP + col] = 1;
      }
    }
  }
}

/** Capsule (round-capped stroke) fill: distance to segment ≤ r at supersample centres. */
function fillSegment(mask, seg) {
  const r = seg.r * SCALE * SS;
  const x1 = seg.x1 * SCALE * SS + OX * SS;
  const y1 = seg.y1 * SCALE * SS + OY * SS;
  const x2 = seg.x2 * SCALE * SS + OX * SS;
  const y2 = seg.y2 * SCALE * SS + OY * SS;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - r - 2));
  const maxX = Math.min(SUP - 1, Math.ceil(Math.max(x1, x2) + r + 2));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - r - 2));
  const maxY = Math.min(SUP - 1, Math.ceil(Math.max(y1, y2) + r + 2));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  for (let row = minY; row <= maxY; row += 1) {
    const py = row + 0.5 - y1;
    for (let col = minX; col <= maxX; col += 1) {
      const px = col + 0.5 - x1;
      let t = lenSq === 0 ? 0 : (px * dx + py * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const ex = px - t * dx;
      const ey = py - t * dy;
      if (ex * ex + ey * ey <= r * r) {
        mask[row * SUP + col] = 1;
      }
    }
  }
}

/** Circle coverage at supersample resolution. */
function fillCircle(mask, circle) {
  const r = circle.r * SCALE * SS;
  const cx = circle.cx * SCALE * SS + OX * SS;
  const cy = circle.cy * SCALE * SS + OY * SS;
  const minX = Math.max(0, Math.floor(cx - r - 2));
  const maxX = Math.min(SUP - 1, Math.ceil(cx + r + 2));
  const minY = Math.max(0, Math.floor(cy - r - 2));
  const maxY = Math.min(SUP - 1, Math.ceil(cy + r + 2));
  for (let row = minY; row <= maxY; row += 1) {
    const py = row + 0.5 - cy;
    for (let col = minX; col <= maxX; col += 1) {
      const px = col + 0.5 - cx;
      if (px * px + py * py <= r * r) {
        mask[row * SUP + col] = 1;
      }
    }
  }
}

/**
 * 16-sample box downsample of the two coverage masks into one RGBA frame.
 * `backgroundColor` may be null for fully transparent output (monochrome).
 */
function composite(blueMask, goldMask, pageColor, goldColor, backgroundColor) {
  const png = new PNG({ width: OUT, height: OUT });
  const data = png.data;
  for (let oy = 0; oy < OUT; oy += 1) {
    for (let ox = 0; ox < OUT; ox += 1) {
      let blueCount = 0;
      let goldCount = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        const row = oy * SS + sy;
        const colBase = ox * SS;
        for (let sx = 0; sx < SS; sx += 1) {
          const idx = row * SUP + (colBase + sx);
          if (blueMask[idx]) blueCount += 1;
          if (goldMask[idx]) goldCount += 1;
        }
      }
      const i = (oy * OUT + ox) * 4;
      let r;
      let g;
      let b;
      let a;
      if (backgroundColor) {
        r = backgroundColor[0];
        g = backgroundColor[1];
        b = backgroundColor[2];
        a = 255;
      } else {
        r = 0;
        g = 0;
        b = 0;
        a = 0;
      }
      // Compositing order: pages/spine (blue) then gold marks above them.
      const blueC = blueCount / (SS * SS);
      if (blueC > 0) {
        if (backgroundColor) {
          r = Math.round(r + (pageColor[0] - r) * blueC);
          g = Math.round(g + (pageColor[1] - g) * blueC);
          b = Math.round(b + (pageColor[2] - b) * blueC);
        } else {
          // Non-premultiplied alpha: full-strength RGB, coverage -> alpha.
          r = Math.max(r, pageColor[0]);
          g = Math.max(g, pageColor[1]);
          b = Math.max(b, pageColor[2]);
          a = Math.round(Math.max(a / 255, blueC) * 255);
        }
      }
      const goldC = goldCount / (SS * SS);
      if (goldC > 0) {
        if (backgroundColor) {
          r = Math.round(r + (goldColor[0] - r) * goldC);
          g = Math.round(g + (goldColor[1] - g) * goldC);
          b = Math.round(b + (goldColor[2] - b) * goldC);
        } else {
          r = Math.max(r, goldColor[0]);
          g = Math.max(g, goldColor[1]);
          b = Math.max(b, goldColor[2]);
          a = Math.round(Math.max(a / 255, goldC) * 255);
        }
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return png;
}

function writePng(png, file) {
  const target = path.join(__dirname, '..', file);
  fs.writeFileSync(target, PNG.sync.write(png));
  console.log(`wrote ${file} (${png.width}x${png.height})`);
}

function main() {
  console.log(`rasterizing ${SUP}x${SUP} coverage masks (scale ${SCALE}px/unit)...`);
  const blueMask = allocMask();
  const goldMask = allocMask();

  // Blue layer: mirrored open Bible pages + centre spine.
  fillPolygon(blueMask, leftPagePolygon());
  fillPolygon(blueMask, rightPagePolygon());
  fillSegment(blueMask, SPINE_SEGMENT);

  // Gold layer: ribbon bookmark, sun rays, sun dot.
  fillPolygon(goldMask, RIBBON_POLYGON);
  for (const ray of RAY_SEGMENTS) fillSegment(goldMask, ray);
  fillCircle(goldMask, SUN_DOT);

  writePng(composite(blueMask, goldMask, PAGE_BLUE, GOLD, NAVY_BG), 'assets/images/icon.png');
  writePng(composite(blueMask, goldMask, PAGE_BLUE, GOLD, NAVY_BG), 'assets/images/adaptive-icon.png');
  writePng(composite(blueMask, goldMask, PAGE_BLUE, GOLD, NAVY_BG), 'assets/images/splash-icon.png');
  writePng(composite(blueMask, goldMask, WHITE, WHITE, null), 'assets/images/adaptive-icon-monochrome.png');
  console.log('done.');
}

main();
