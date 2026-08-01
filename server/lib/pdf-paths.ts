import os from 'os';
import path from 'path';

const PDF_BASE_DIR = path.join(os.tmpdir(), 'mediahub-pdf');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidPdfJobId = (id: string): boolean => UUID_PATTERN.test(id);

export const getPdfJobDir = (jobId: string) => path.join(PDF_BASE_DIR, jobId);

export const getPdfInputDir = (jobId: string) => path.join(getPdfJobDir(jobId), 'input');

export const getPdfOutputDir = (jobId: string) => path.join(getPdfJobDir(jobId), 'output');

export const getPdfThumbDir = (jobId: string) => path.join(getPdfJobDir(jobId), 'thumbs');

export const getPdfInputPath = (jobId: string, index: number, ext: string) =>
  path.join(getPdfInputDir(jobId), `source-${index}${ext}`);

export const getPdfOutputPath = (jobId: string, filename: string) => path.join(getPdfOutputDir(jobId), filename);

export const getPdfThumbPath = (jobId: string, page: number) => path.join(getPdfThumbDir(jobId), `page-${page}.jpg`);

export const getPdfInputKey = (jobId: string, index: number, ext: string) => `pdf-uploads/${jobId}/source-${index}${ext}`;

export const getPdfOutputKey = (jobId: string, filename: string) => `pdf-outputs/${jobId}/${filename}`;

export const getPdfThumbKey = (jobId: string, page: number) => `pdf-thumbs/${jobId}/page-${page}.jpg`;
