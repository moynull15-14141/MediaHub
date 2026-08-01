import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import { PDFDocument, degrees, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const execFileAsync = (
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout ?? 60000, maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          (err as any).stderr = stderr;
          (err as any).stdout = stdout;
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

export const formatBytesShort = (bytes: number) => {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// pdf-lib throws a generic Error for both encrypted and structurally invalid
// PDFs - normalize both into stable error codes the controller layer maps to
// clear, user-facing messages.
export const loadPdfDocument = async (bytes: Buffer | Uint8Array): Promise<PDFDocument> => {
  try {
    return await PDFDocument.load(bytes);
  } catch (err: any) {
    if (/encrypt/i.test(err?.message || '')) {
      throw new Error('PDF_IS_PASSWORD_PROTECTED');
    }
    throw new Error('INVALID_PDF_FILE');
  }
};

export const getPdfPageCount = async (filePath: string): Promise<number> => {
  const bytes = await fs.promises.readFile(filePath);
  const doc = await loadPdfDocument(bytes);
  return doc.getPageCount();
};

export const isPdfPasswordProtected = async (filePath: string): Promise<boolean> => {
  try {
    await getPdfPageCount(filePath);
    return false;
  } catch (err: any) {
    return err.message === 'PDF_IS_PASSWORD_PROTECTED';
  }
};

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export const mergePdfs = async (inputPaths: string[], outputPath: string): Promise<void> => {
  const merged = await PDFDocument.create();
  for (const inputPath of inputPaths) {
    const bytes = await fs.promises.readFile(inputPath);
    const doc = await loadPdfDocument(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  await fs.promises.writeFile(outputPath, await merged.save());
};

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

export interface SplitRange {
  from: number;
  to: number;
}

export const splitPdf = async (inputPath: string, ranges: SplitRange[], outputDir: string): Promise<string[]> => {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const bytes = await fs.promises.readFile(inputPath);
  const src = await loadPdfDocument(bytes);
  const outputPaths: string[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const { from, to } = ranges[i];
    const out = await PDFDocument.create();
    const indices: number[] = [];
    for (let p = from; p <= to; p++) indices.push(p - 1);
    const pages = await out.copyPages(src, indices);
    pages.forEach((page) => out.addPage(page));
    const outPath = path.join(outputDir, `part-${i + 1}-p${from}-${to}.pdf`);
    await fs.promises.writeFile(outPath, await out.save());
    outputPaths.push(outPath);
  }

  return outputPaths;
};

// ---------------------------------------------------------------------------
// Rotate
// ---------------------------------------------------------------------------

export const rotatePdf = async (
  inputPath: string,
  outputPath: string,
  angle: 90 | 180 | 270,
  pages?: number[],
): Promise<void> => {
  const bytes = await fs.promises.readFile(inputPath);
  const doc = await loadPdfDocument(bytes);
  const targetSet = pages && pages.length > 0 ? new Set(pages) : null;

  doc.getPages().forEach((page, idx) => {
    const pageNum = idx + 1;
    if (targetSet && !targetSet.has(pageNum)) return;
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle + 360) % 360));
  });

  await fs.promises.writeFile(outputPath, await doc.save());
};

// ---------------------------------------------------------------------------
// Delete pages
// ---------------------------------------------------------------------------

export const deletePages = async (inputPath: string, outputPath: string, pagesToDelete: number[]): Promise<void> => {
  const bytes = await fs.promises.readFile(inputPath);
  const doc = await loadPdfDocument(bytes);
  const total = doc.getPageCount();
  const deleteSet = new Set(pagesToDelete.filter((p) => p >= 1 && p <= total));

  if (deleteSet.size === 0) throw new Error('NO_VALID_PAGES_TO_DELETE');
  if (deleteSet.size >= total) throw new Error('CANNOT_DELETE_ALL_PAGES');

  // Remove from the highest index down so earlier indices stay valid as we go.
  [...deleteSet].sort((a, b) => b - a).forEach((pageNum) => doc.removePage(pageNum - 1));

  await fs.promises.writeFile(outputPath, await doc.save());
};

// ---------------------------------------------------------------------------
// Rearrange
// ---------------------------------------------------------------------------

export const rearrangePages = async (inputPath: string, outputPath: string, order: number[]): Promise<void> => {
  const bytes = await fs.promises.readFile(inputPath);
  const src = await loadPdfDocument(bytes);
  const total = src.getPageCount();
  const isValidPermutation =
    order.length === total && new Set(order).size === total && order.every((n) => n >= 1 && n <= total);
  if (!isValidPermutation) throw new Error('INVALID_PAGE_ORDER');

  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, order.map((n) => n - 1));
  pages.forEach((page) => out.addPage(page));
  await fs.promises.writeFile(outputPath, await out.save());
};

// ---------------------------------------------------------------------------
// JPG -> PDF
// ---------------------------------------------------------------------------

export const jpgToPdf = async (inputPaths: string[], outputPath: string): Promise<void> => {
  const doc = await PDFDocument.create();
  for (const imagePath of inputPaths) {
    const jpegBuffer = await sharp(imagePath).rotate().jpeg({ quality: 92 }).toBuffer();
    const image = await doc.embedJpg(jpegBuffer);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  await fs.promises.writeFile(outputPath, await doc.save());
};

// ---------------------------------------------------------------------------
// PDF -> Image (Ghostscript rasterization, JPEG or PNG)
// ---------------------------------------------------------------------------

export type RasterFormat = 'jpeg' | 'png';

const RASTER_DEVICE: Record<RasterFormat, string> = { jpeg: 'jpeg', png: 'png16m' };
const RASTER_EXT: Record<RasterFormat, string> = { jpeg: 'jpg', png: 'png' };

export const pdfToImage = async (
  inputPath: string,
  outputDir: string,
  format: RasterFormat = 'jpeg',
  dpi = 150,
): Promise<string[]> => {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const ext = RASTER_EXT[format];
  const pattern = path.join(outputDir, `page-%03d.${ext}`);
  const args = ['-dNOPAUSE', '-dBATCH', '-dSAFER', `-sDEVICE=${RASTER_DEVICE[format]}`, `-r${dpi}`];
  if (format === 'jpeg') args.push('-dJPEGQ=90');
  args.push(`-sOutputFile=${pattern}`, inputPath);
  await execFileAsync('gs', args, { timeout: 180000 });
  const files = (await fs.promises.readdir(outputDir)).filter((f) => f.startsWith('page-')).sort();
  if (files.length === 0) throw new Error('PDF_RENDER_FAILED');
  return files.map((f) => path.join(outputDir, f));
};

// Full-document thumbnail sheet, used by the Rearrange/Delete/Rotate UIs to
// show real page previews instead of bare page numbers. Edit Text uses a
// higher DPI (150 vs 72) since users need to read and click individual
// words precisely, not just recognize the page layout.
export const generatePageThumbnails = async (
  inputPath: string,
  outputDir: string,
  maxPages = 300,
  dpi = 72,
): Promise<number> => {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const pattern = path.join(outputDir, 'page-%d.jpg');
  await execFileAsync(
    'gs',
    [
      '-dNOPAUSE', '-dBATCH', '-dSAFER',
      '-sDEVICE=jpeg', `-r${dpi}`, '-dJPEGQ=70',
      `-dLastPage=${maxPages}`,
      `-sOutputFile=${pattern}`,
      inputPath,
    ],
    { timeout: 180000 },
  );
  const files = await fs.promises.readdir(outputDir);
  return files.length;
};

// ---------------------------------------------------------------------------
// Compress
// ---------------------------------------------------------------------------

export type CompressLevel = 'low' | 'recommended' | 'high';

const LEVEL_TO_SETTINGS: Record<CompressLevel, string> = {
  low: '/printer',
  recommended: '/ebook',
  high: '/screen',
};

const runGhostscriptCompress = async (
  inputPath: string,
  outputPath: string,
  pdfSettings: string,
  resolution?: number,
) => {
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-dPDFSETTINGS=${pdfSettings}`,
    '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dQUIET',
  ];
  if (resolution) {
    args.push(
      '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true', '-dDownsampleMonoImages=true',
      '-dColorImageDownsampleType=/Bicubic', '-dGrayImageDownsampleType=/Bicubic',
      `-dColorImageResolution=${resolution}`, `-dGrayImageResolution=${resolution}`, `-dMonoImageResolution=${resolution * 2}`,
    );
  }
  args.push(`-sOutputFile=${outputPath}`, inputPath);
  await execFileAsync('gs', args, { timeout: 180000 });
};

export const quickCompressPdf = async (inputPath: string, outputPath: string, level: CompressLevel): Promise<void> => {
  await runGhostscriptCompress(inputPath, outputPath, LEVEL_TO_SETTINGS[level]);
};

export interface CompressResult {
  achievedBytes: number;
  message?: string;
}

// Mildest -> most aggressive. We stop at the first attempt that meets the
// target so quality is only sacrificed as much as actually needed.
const TARGET_ATTEMPTS: { pdfSettings: string; resolution: number }[] = [
  { pdfSettings: '/printer', resolution: 300 },
  { pdfSettings: '/ebook', resolution: 200 },
  { pdfSettings: '/ebook', resolution: 150 },
  { pdfSettings: '/ebook', resolution: 120 },
  { pdfSettings: '/screen', resolution: 100 },
  { pdfSettings: '/screen', resolution: 72 },
  { pdfSettings: '/screen', resolution: 50 },
];

export const compressPdfToTarget = async (
  inputPath: string,
  outputPath: string,
  targetBytes: number,
): Promise<CompressResult> => {
  const originalSize = (await fs.promises.stat(inputPath)).size;
  if (targetBytes >= originalSize) {
    await fs.promises.copyFile(inputPath, outputPath);
    return { achievedBytes: originalSize, message: 'The file is already at or under the requested size - no compression was needed.' };
  }

  let bestPath: string | null = null;
  let bestSize = Infinity;

  for (let i = 0; i < TARGET_ATTEMPTS.length; i++) {
    const attempt = TARGET_ATTEMPTS[i];
    const attemptPath = `${outputPath}.attempt-${i}.pdf`;
    try {
      await runGhostscriptCompress(inputPath, attemptPath, attempt.pdfSettings, attempt.resolution);
      const size = (await fs.promises.stat(attemptPath)).size;
      if (size < bestSize) {
        if (bestPath) await fs.promises.rm(bestPath, { force: true });
        bestPath = attemptPath;
        bestSize = size;
      } else {
        await fs.promises.rm(attemptPath, { force: true });
      }
      if (size <= targetBytes) break;
    } catch {
      await fs.promises.rm(attemptPath, { force: true }).catch(() => {});
      // Keep trying more aggressive settings.
    }
  }

  if (!bestPath) throw new Error('COMPRESSION_FAILED');
  await fs.promises.rename(bestPath, outputPath);

  const message =
    bestSize <= targetBytes
      ? undefined
      : `Could not reach the requested size while keeping the PDF readable. Closest achievable size is ${formatBytesShort(bestSize)}.`;
  return { achievedBytes: bestSize, message };
};

// ---------------------------------------------------------------------------
// Protect / Unlock (qpdf)
// ---------------------------------------------------------------------------

export const protectPdf = async (inputPath: string, outputPath: string, password: string): Promise<void> => {
  try {
    await execFileAsync('qpdf', ['--encrypt', password, password, '256', '--', inputPath, outputPath], { timeout: 60000 });
  } catch (err: any) {
    if (/already encrypted/i.test(err.stderr || '')) {
      throw new Error('PDF_ALREADY_PROTECTED');
    }
    throw err;
  }
};

export const unlockPdf = async (inputPath: string, outputPath: string, password: string): Promise<void> => {
  try {
    await execFileAsync('qpdf', ['--decrypt', `--password=${password}`, inputPath, outputPath], { timeout: 60000 });
  } catch (err: any) {
    const stderr = err.stderr || err.message || '';
    if (/invalid password|failed to decrypt/i.test(stderr)) {
      throw new Error('INCORRECT_PASSWORD');
    }
    if (/not encrypted/i.test(stderr)) {
      throw new Error('PDF_NOT_PROTECTED');
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Zip (for multi-file results: Split, PDF -> JPG)
// ---------------------------------------------------------------------------

export const zipFiles = (filePaths: string[], outputZipPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    filePaths.forEach((filePath) => archive.file(filePath, { name: path.basename(filePath) }));
    void archive.finalize();
  });

// ---------------------------------------------------------------------------
// Edit text (locate existing text runs, then redact + overlay replacements)
// ---------------------------------------------------------------------------
//
// PDFs don't store text as an editable document model - there's no reliable
// way to rewrite an existing content-stream text operator in place without
// risking corrupting the page. Instead we do what most "quick edit" PDF
// tools actually do: find the exact position/size of the text run via
// pdf.js, paint a white rectangle over it, and draw the replacement text at
// the same baseline. This looks correct visually, but the original text
// technically remains in the file underneath the redaction (still present
// for copy/search) - this is NOT a secure redaction tool.

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export const getPdfPageDimensions = async (inputPath: string, pageNumber: number): Promise<{ width: number; height: number }> => {
  const data = new Uint8Array(await fs.promises.readFile(inputPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) throw new Error('INVALID_PAGE_NUMBER');
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
};

export const extractTextItems = async (inputPath: string, pageNumber: number): Promise<TextItem[]> => {
  const data = new Uint8Array(await fs.promises.readFile(inputPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) throw new Error('INVALID_PAGE_NUMBER');
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  for (const raw of content.items as any[]) {
    if (!raw.str || !raw.str.trim()) continue;
    const [, , , d, e, f] = raw.transform;
    const fontSize = Math.abs(d) || raw.height || 12;
    items.push({ text: raw.str, x: e, y: f, width: raw.width, height: raw.height || fontSize, fontSize });
  }
  return items;
};

export interface TextEdit {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  newText: string;
}

export const applyTextEdits = async (inputPath: string, outputPath: string, edits: TextEdit[]): Promise<void> => {
  const bytes = await fs.promises.readFile(inputPath);
  const doc = await loadPdfDocument(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const edit of edits) {
    const page = pages[edit.page - 1];
    if (!page) continue;
    const marginY = edit.fontSize * 0.3;
    page.drawRectangle({
      x: edit.x - 1,
      y: edit.y - marginY,
      width: edit.width + 2,
      height: edit.fontSize + marginY * 1.5,
      color: rgb(1, 1, 1),
    });
    if (edit.newText) {
      page.drawText(edit.newText, { x: edit.x, y: edit.y, size: edit.fontSize, font, color: rgb(0, 0, 0) });
    }
  }

  await fs.promises.writeFile(outputPath, await doc.save());
};
