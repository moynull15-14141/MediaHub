import os from 'os';
import path from 'path';

const IMAGE_BASE_DIR = path.join(os.tmpdir(), 'mediahub-images');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidImageJobId = (id: string): boolean => UUID_PATTERN.test(id);

export const getImageJobDir = (jobId: string) => path.join(IMAGE_BASE_DIR, jobId);

export const getImageInputDir = (jobId: string) => path.join(getImageJobDir(jobId), 'input');

export const getImageOutputDir = (jobId: string) => path.join(getImageJobDir(jobId), 'output');

export const getImageInputPath = (jobId: string, ext: string) => path.join(getImageInputDir(jobId), `source${ext}`);

export const getImageOutputPath = (jobId: string, ext: string) => path.join(getImageOutputDir(jobId), `output${ext}`);

export const getImageInputKey = (jobId: string, ext: string) => `image-uploads/${jobId}/source${ext}`;

export const getImageOutputKey = (jobId: string, ext: string) => `image-outputs/${jobId}/output${ext}`;
