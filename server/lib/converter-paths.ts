import os from 'os';
import path from 'path';

const CONVERTER_BASE_DIR = path.join(os.tmpdir(), 'mediahub-converter');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidJobId = (id: string): boolean => UUID_PATTERN.test(id);

export const getJobDir = (jobId: string) => path.join(CONVERTER_BASE_DIR, jobId);

export const getInputDir = (jobId: string) => path.join(getJobDir(jobId), 'input');

export const getOutputDir = (jobId: string) => path.join(getJobDir(jobId), 'output');

export const getInputPath = (jobId: string, ext: string) => path.join(getInputDir(jobId), `source${ext}`);

export const getOutputPath = (jobId: string, ext: string) => path.join(getOutputDir(jobId), `converted${ext}`);

export const getInputKey = (jobId: string, ext: string) => `uploads/${jobId}/source${ext}`;

export const getOutputKey = (jobId: string, ext: string) => `outputs/${jobId}/converted${ext}`;
