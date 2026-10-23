/**
 * Collage composer using sharp — Pinterest-style.
 *
 * Images keep their natural aspect ratios (no square cropping) and are laid out
 * in a balanced grid on a white/near-white background, just like a Pinterest board
 * or a newspaper photo spread. Returns a single JPEG buffer ready to save.
 */
import sharp from "sharp";

export interface CollageOptions {
  images: { data: Buffer; mime: string; label?: string }[];
  /** Target collage width in px. Default 1200. */
  width?: number;
  /** JPEG quality 1-100. Default 90. */
  quality?: number;
  /** Gap between cells in px. Default 8. */
  gap?: number;
  /** Background colour hex. Default #f8f8f8 (near-white). */
  background?: string;
}

export interface CollageResult {
  data: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  cellCount: number;
}

/** Compute the intrinsic width & height of a buffer using sharp metadata. */
async function intrinsicSize(buf: Buffer): Promise<{ w: number; h: number }> {
  try {
    const meta = await sharp(buf).metadata();
    return { w: meta.width || 400, h: meta.height || 400 };
  } catch {
    return { w: 400, h: 400 };
  }
}

/**
 * Arrange N images in a balanced column grid while preserving their aspect ratios.
 * Each column gets roughly the same total height, like a Pinterest masonry board.
 */
export async function makeCollage(opts: CollageOptions): Promise<CollageResult> {
  const { images, width = 1200, quality = 90, gap = 8 } = opts;
  const bg = opts.background ?? "#f8f8f8";

  if (!images.length) throw new Error("No images to arrange");

  const n = images.length;
  // Column count: 1 → 1 col, 2-3 → 2 cols, 4+ → 3 cols  (just like Pinterest)
  const cols = n === 1 ? 1 : n <= 3 ? 2 : 3;
  const cellW = Math.floor((width - gap * (cols + 1)) / cols);

  // ---- Decode, auto-orient, and resize all images to the target column width ----
  type Cell = { buf: Buffer; w: number; h: number; idx: number };

  const cells: Cell[] = await Promise.all(
    images.map(async (img, idx) => {
      try {
        // Auto-orient from EXIF, then scale to cellW preserving aspect ratio
        const resized = await sharp(img.data)
          .rotate()
          .resize(cellW, undefined, { fit: "inside", withoutEnlargement: false })
          .toBuffer({ resolveWithObject: true });
        return {
          buf: resized.data,
          w: resized.info.width,
          h: resized.info.height,
          idx,
        };
      } catch {
        // Broken image → dark placeholder
        const placeholder = await sharp({
          create: { width: cellW, height: Math.round(cellW * 0.75), channels: 3, background: { r: 220, g: 220, b: 220 } },
        })
          .jpeg({ quality: 70 })
          .toBuffer();
        return { buf: placeholder, w: cellW, h: Math.round(cellW * 0.75), idx };
      }
    })
  );

  // ---- Greedy column assignment (shortest-column-first, like Pinterest) ----
  const colHeights = Array(cols).fill(gap) as number[];
  const colItems: Cell[][] = Array.from({ length: cols }, () => []);

  for (const cell of cells) {
    const shortest = colHeights.indexOf(Math.min(...colHeights));
    colItems[shortest].push(cell);
    colHeights[shortest] += cell.h + gap;
  }

  const canvasH = Math.max(...colHeights);

  // ---- Parse background colour ----
  const hexToRgb = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  const bgRgb = bg.startsWith("#") ? hexToRgb(bg) : { r: 248, g: 248, b: 248 };

  // ---- Build composite list ----
  const composites: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [];
  for (let c = 0; c < cols; c++) {
    const left = gap + c * (cellW + gap);
    let top = gap;
    for (const cell of colItems[c]) {
      composites.push({ input: cell.buf, left, top });
      top += cell.h + gap;
    }
  }

  const data = await sharp({
    create: { width, height: canvasH, channels: 3, background: bgRgb },
  })
    .composite(composites)
    .jpeg({ quality })
    .toBuffer();

  return { data, mime: "image/jpeg", width, height: canvasH, cellCount: cells.length };
}
