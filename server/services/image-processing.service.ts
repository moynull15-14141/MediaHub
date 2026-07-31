import sharp from 'sharp';
import fs from 'fs';
import exifr from 'exifr';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'avif';
export type ResizeFit = 'fill' | 'contain' | 'cover' | 'inside' | 'outside';
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
export type ImageColorSpace = 'srgb' | 'cmyk' | 'b-w';

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
  watermarkPosition?: WatermarkPosition;
  watermarkScale?: number;
  watermarkPadding?: number;
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
  const padding = options.watermarkPadding ?? 16;
  const position = options.watermarkPosition ?? 'bottom-right';

  let overlayBuffer: Buffer;
  let overlayWidth: number;
  let overlayHeight: number;

  if (options.watermarkImagePath) {
    const targetWidth = Math.max(1, Math.round(baseWidth * scale));
    const resized = await sharp(options.watermarkImagePath).resize({ width: targetWidth }).ensureAlpha().toBuffer();
    const meta = await sharp(resized).metadata();
    overlayWidth = meta.width || targetWidth;
    overlayHeight = meta.height || targetWidth;
    const base64 = resized.toString('base64');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${overlayWidth}" height="${overlayHeight}"><image href="data:image/png;base64,${base64}" width="${overlayWidth}" height="${overlayHeight}" opacity="${opacity}"/></svg>`;
    overlayBuffer = Buffer.from(svg);
  } else if (options.watermarkText) {
    const fontSize = Math.max(12, Math.round(baseWidth * scale * 0.3));
    const text = options.watermarkText.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
    overlayWidth = Math.min(baseWidth, Math.round(text.length * fontSize * 0.6) + 20);
    overlayHeight = Math.round(fontSize * 1.6);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${overlayWidth}" height="${overlayHeight}">
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="sans-serif" fill="white" fill-opacity="${opacity}" stroke="black" stroke-opacity="${opacity * 0.5}" stroke-width="1">${text}</text>
    </svg>`;
    overlayBuffer = Buffer.from(svg);
  } else {
    return [];
  }

  let left: number;
  let top: number;
  switch (position) {
    case 'top-left':
      left = padding;
      top = padding;
      break;
    case 'top-right':
      left = baseWidth - overlayWidth - padding;
      top = padding;
      break;
    case 'bottom-left':
      left = padding;
      top = baseHeight - overlayHeight - padding;
      break;
    case 'center':
      left = Math.round((baseWidth - overlayWidth) / 2);
      top = Math.round((baseHeight - overlayHeight) / 2);
      break;
    case 'bottom-right':
    default:
      left = baseWidth - overlayWidth - padding;
      top = baseHeight - overlayHeight - padding;
      break;
  }

  return [{ input: overlayBuffer, left: Math.max(0, left), top: Math.max(0, top) }];
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
