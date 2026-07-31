import sharp from 'sharp';
import fs from 'fs';
import exifr from 'exifr';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'avif';
export type ResizeFit = 'fill' | 'contain' | 'cover' | 'inside' | 'outside';
export type ImageColorSpace = 'srgb' | 'cmyk' | 'b-w';

// The only font-family values the SVG watermark renderer will accept - these
// match the font packages actually installed in the container (Dockerfile),
// so what the user picks is guaranteed to render as a genuinely different
// typeface rather than silently falling back to whatever librsvg finds.
export const WATERMARK_FONTS = [
  'DejaVu Sans',
  'DejaVu Serif',
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'Noto Sans',
  'Carlito',
  'Caladea',
] as const;
export type WatermarkFont = typeof WATERMARK_FONTS[number];

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface ImageProcessOptions {
  outputFormat: ImageOutputFormat;
  quality: number;
  progressive?: boolean;
  lossless?: boolean;
  preserveMetadata?: boolean;
  colorSpace?: ImageColorSpace;

  resizeWidth?: number;
  resizeHeight?: number;
  resizePercent?: number;
  fit?: ResizeFit;

  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;

  rotate?: 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;

  watermarkText?: string;
  watermarkImagePath?: string;
  watermarkOpacity?: number;
  watermarkScale?: number;
  // Center point of the watermark, as a 0-100 percentage of the image's
  // width/height - lets the user drag it to any free position on the canvas
  // instead of picking from a fixed set of corners.
  watermarkXPercent?: number;
  watermarkYPercent?: number;
  watermarkFontFamily?: WatermarkFont;
  watermarkColor?: string;
  watermarkBold?: boolean;

  // -100..100, 0 = no change
  brightness?: number;
  contrast?: number;
  saturation?: number;
  // -180..180 degrees, 0 = no change
  hue?: number;
}

export interface ProbeResult {
  width: number | null;
  height: number | null;
  format: string | null;
  space: string | null;
  hasAlpha: boolean;
  density: number | null;
  channels: number | null;
  depth: string | null;
}

export const probeImage = async (filePath: string): Promise<ProbeResult> => {
  const meta = await sharp(filePath).metadata();
  return {
    width: meta.width ?? null,
    height: meta.height ?? null,
    format: meta.format ?? null,
    space: meta.space ?? null,
    hasAlpha: meta.hasAlpha ?? false,
    density: meta.density ?? null,
    channels: meta.channels ?? null,
    depth: meta.depth ?? null,
  };
};

export interface FullMetadata {
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  format: string | null;
  colorSpace: string | null;
  bitDepth: string | null;
  dpi: number | null;
  hasAlpha: boolean;
  exif: {
    make?: string;
    model?: string;
    dateTimeOriginal?: string;
    modifyDate?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    orientation?: number;
  } | null;
}

export const getFullMetadata = async (filePath: string): Promise<FullMetadata> => {
  const [probe, stat] = await Promise.all([probeImage(filePath), fs.promises.stat(filePath)]);

  let exif: FullMetadata['exif'] = null;
  try {
    const parsed = await exifr.parse(filePath, { gps: true, exif: true, tiff: true });
    if (parsed) {
      exif = {
        make: parsed.Make,
        model: parsed.Model,
        dateTimeOriginal: parsed.DateTimeOriginal ? new Date(parsed.DateTimeOriginal).toISOString() : undefined,
        modifyDate: parsed.ModifyDate ? new Date(parsed.ModifyDate).toISOString() : undefined,
        gpsLatitude: parsed.latitude,
        gpsLongitude: parsed.longitude,
        orientation: parsed.Orientation,
      };
    }
  } catch {
    // No EXIF data or unsupported format for parsing - not an error condition.
  }

  return {
    fileSizeBytes: stat.size,
    width: probe.width,
    height: probe.height,
    format: probe.format,
    colorSpace: probe.space,
    bitDepth: probe.depth,
    dpi: probe.density,
    hasAlpha: probe.hasAlpha,
    exif,
  };
};

const buildWatermarkOverlay = async (
  baseWidth: number,
  baseHeight: number,
  options: ImageProcessOptions,
): Promise<{ input: Buffer; left: number; top: number }[]> => {
  const opacity = options.watermarkOpacity ?? 1;
  const scale = options.watermarkScale ?? 0.25;
  const xPercent = options.watermarkXPercent ?? 85;
  const yPercent = options.watermarkYPercent ?? 85;
  // These two values get embedded directly into an SVG string below, so they
  // must be strictly validated here rather than trusted from the caller -
  // font-family must be one of the fonts actually installed in the
  // container, and color must be a plain #rrggbb hex value.
  const fontFamily = options.watermarkFontFamily && WATERMARK_FONTS.includes(options.watermarkFontFamily)
    ? options.watermarkFontFamily
    : 'DejaVu Sans';
  const color = options.watermarkColor && HEX_COLOR_PATTERN.test(options.watermarkColor)
    ? options.watermarkColor
    : '#ffffff';

  if (options.watermarkText) {
    const fontWeight = options.watermarkBold ? 'bold' : 'normal';
    const text = options.watermarkText.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
    const maxWidth = baseWidth * 0.92;

    // Font size alone (not text length) drove the previous size formula, so
    // a long string at a normal-looking "scale" could render wider than the
    // image itself and get clipped by the image edge. Instead, render onto
    // a generously oversized canvas, trim to the actual ink bounding box,
    // and shrink the font if that measured width doesn't fit - one
    // rendering pass to measure, a second only if a correction is needed.
    const renderTrimmed = async (fontSize: number) => {
      const canvasW = baseWidth * 2;
      const canvasH = Math.round(fontSize * 3);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
        <text x="${canvasW / 2}" y="${Math.round(canvasH * 0.6)}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}" fill="${color}" fill-opacity="${opacity}" stroke="black" stroke-opacity="${opacity * 0.35}" stroke-width="1" text-anchor="middle">${text}</text>
      </svg>`;
      return sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
    };

    let fontSize = Math.max(12, Math.round(baseWidth * scale * 0.3));
    let { data, info } = await renderTrimmed(fontSize);
    if (info.width > maxWidth) {
      fontSize = Math.max(8, Math.round(fontSize * (maxWidth / info.width)));
      ({ data, info } = await renderTrimmed(fontSize));
    }

    const overlayWidth = info.width;
    const overlayHeight = info.height;
    const left = Math.round((baseWidth * xPercent) / 100 - overlayWidth / 2);
    const top = Math.round((baseHeight * yPercent) / 100 - overlayHeight / 2);
    return [{
      input: data,
      left: Math.max(0, Math.min(left, baseWidth - overlayWidth)),
      top: Math.max(0, Math.min(top, baseHeight - overlayHeight)),
    }];
  }

  if (options.watermarkImagePath) {
    const targetWidth = Math.max(1, Math.round(baseWidth * scale));
    const resized = await sharp(options.watermarkImagePath).resize({ width: targetWidth }).ensureAlpha().toBuffer();
    const meta = await sharp(resized).metadata();
    const overlayWidth = meta.width || targetWidth;
    const overlayHeight = meta.height || targetWidth;
    const base64 = resized.toString('base64');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${overlayWidth}" height="${overlayHeight}"><image href="data:image/png;base64,${base64}" width="${overlayWidth}" height="${overlayHeight}" opacity="${opacity}"/></svg>`;
    const left = Math.round((baseWidth * xPercent) / 100 - overlayWidth / 2);
    const top = Math.round((baseHeight * yPercent) / 100 - overlayHeight / 2);
    return [{
      input: Buffer.from(svg),
      left: Math.max(0, Math.min(left, baseWidth - overlayWidth)),
      top: Math.max(0, Math.min(top, baseHeight - overlayHeight)),
    }];
  }

  return [];
};

export const processImage = async (
  inputPath: string,
  outputPath: string,
  options: ImageProcessOptions,
): Promise<void> => {
  let pipeline = sharp(inputPath, { failOn: 'error' });

  if (
    options.cropWidth !== undefined &&
    options.cropHeight !== undefined &&
    options.cropX !== undefined &&
    options.cropY !== undefined
  ) {
    pipeline = pipeline.extract({
      left: Math.round(options.cropX),
      top: Math.round(options.cropY),
      width: Math.round(options.cropWidth),
      height: Math.round(options.cropHeight),
    });
  }

  // Auto-orient based on EXIF orientation first (e.g. phone photos shot
  // sideways), then apply any additional explicit rotation on top.
  pipeline = pipeline.rotate();
  if (options.rotate) {
    pipeline = pipeline.rotate(options.rotate);
  }
  if (options.flipHorizontal) {
    pipeline = pipeline.flop();
  }
  if (options.flipVertical) {
    pipeline = pipeline.flip();
  }

  if (options.resizePercent) {
    // Percentage is relative to the post-crop dimensions when a crop was
    // applied, not the original file's dimensions.
    let baseWidth: number;
    let baseHeight: number;
    if (options.cropWidth && options.cropHeight) {
      baseWidth = Math.round(options.cropWidth);
      baseHeight = Math.round(options.cropHeight);
    } else {
      const meta = await sharp(inputPath).metadata();
      baseWidth = meta.width || 0;
      baseHeight = meta.height || 0;
    }
    if (baseWidth && baseHeight) {
      pipeline = pipeline.resize({
        width: Math.max(1, Math.round((baseWidth * options.resizePercent) / 100)),
        height: Math.max(1, Math.round((baseHeight * options.resizePercent) / 100)),
        fit: options.fit || 'fill',
      });
    }
  } else if (options.resizeWidth || options.resizeHeight) {
    pipeline = pipeline.resize({
      width: options.resizeWidth,
      height: options.resizeHeight,
      fit: options.fit || 'cover',
      withoutEnlargement: false,
    });
  }

  if (options.brightness || options.saturation || options.hue) {
    // Sharp's modulate() rejects a key that's present but explicitly
    // undefined (throws "Expected number... but received undefined")
    // rather than treating it as omitted, so only include the keys that
    // actually have a value.
    const modulate: { brightness?: number; saturation?: number; hue?: number } = {};
    if (options.brightness) modulate.brightness = 1 + options.brightness / 100;
    if (options.saturation) modulate.saturation = 1 + options.saturation / 100;
    if (options.hue) modulate.hue = options.hue;
    pipeline = pipeline.modulate(modulate);
  }
  if (options.contrast) {
    // sharp has no direct "contrast" knob - the standard formula scales
    // pixel values around the midpoint (128) by a contrast factor.
    const c = options.contrast * 2.55; // slider is -100..100, formula wants -255..255
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    pipeline = pipeline.linear(factor, 128 * (1 - factor));
  }

  if (options.watermarkText || options.watermarkImagePath) {
    // Dimensions after crop/rotate/resize are needed to position the overlay -
    // cheapest way to get them without a second decode is to render to a
    // buffer first, then composite on top of that buffer.
    const intermediate = await pipeline.toBuffer({ resolveWithObject: true });
    const overlays = await buildWatermarkOverlay(
      intermediate.info.width,
      intermediate.info.height,
      options,
    );
    pipeline = sharp(intermediate.data).composite(overlays);
  }

  if (options.colorSpace) {
    pipeline = pipeline.toColorspace(options.colorSpace);
  }

  // Sharp strips all metadata (EXIF/ICC/orientation) by default on output;
  // only call withMetadata() when the caller explicitly wants it preserved.
  if (options.preserveMetadata) {
    pipeline = pipeline.withMetadata();
  }

  switch (options.outputFormat) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: options.quality, progressive: !!options.progressive, mozjpeg: true });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: options.quality, lossless: !!options.lossless });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality: options.quality });
      break;
    case 'png':
    default:
      pipeline = pipeline.png({ quality: options.quality, compressionLevel: 9 });
      break;
  }

  await pipeline.toFile(outputPath);
};

export const generateThumbnail = async (inputPath: string, outputPath: string, size: number): Promise<void> => {
  await sharp(inputPath)
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .toFormat('jpeg', { quality: 85 })
    .toFile(outputPath);
};
