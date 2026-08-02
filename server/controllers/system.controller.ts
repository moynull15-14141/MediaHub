import { Request, Response } from 'express';
import { getLiveness, getReadiness, getSystemStatus, getDiagnostics } from '../services/diagnostics.service';

const httpStatusFor = (level: string): number => (level === 'critical' ? 503 : 200);

export const healthHandler = (_req: Request, res: Response) => {
  const result = getLiveness();
  res.status(httpStatusFor(result.status)).json(result);
};

export const statusHandler = async (_req: Request, res: Response) => {
  const result = await getReadiness();
  res.status(httpStatusFor(result.status)).json(result);
};

export const systemHandler = async (_req: Request, res: Response) => {
  const result = await getSystemStatus();
  res.status(httpStatusFor(result.status)).json(result);
};

export const diagnosticsHandler = async (_req: Request, res: Response) => {
  const result = await getDiagnostics();
  res.status(httpStatusFor(result.overallStatus)).json(result);
};
