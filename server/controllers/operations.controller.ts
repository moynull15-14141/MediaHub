import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId } from '../lib/require-workspace';
import {
  getAccountOperations,
  getAccountLimits,
  getAccountQuality,
  getAccountRouting,
  getDashboardOperations,
  OperationsError,
} from '../services/operations.service';
import { manualFailover, rebalanceAccount, AccountFailoverError } from '../services/account-failover.service';
import { resetDailyLimitNow, DailyLimitError } from '../services/daily-limit-engine.service';

const handleOperationsError = (err: any, res: Response, fallback: string) => {
  if (err instanceof OperationsError || err instanceof AccountFailoverError || err instanceof DailyLimitError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

// Phase B.5 - Production Operations & Multi-Tenant Reliability. Self-service
// GET endpoints (caller's own account) gated by settings:read/analytics:read
// in whatsapp.routes.ts, matching every other /account/* read route; the
// three POST actions are self-service writes gated by settings:write, same
// convention as the pre-existing /account/resume.

export const accountOperationsHandler = async (req: Request, res: Response) => {
  try {
    const result = await getAccountOperations(getUserId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to load account operations');
  }
};

export const accountLimitsHandler = async (req: Request, res: Response) => {
  try {
    const result = await getAccountLimits(getUserId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to load account limits');
  }
};

export const accountRoutingHandler = async (req: Request, res: Response) => {
  try {
    const result = await getAccountRouting(getWorkspaceId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to load routing preview');
  }
};

export const accountQualityHandler = async (req: Request, res: Response) => {
  try {
    const result = await getAccountQuality(getUserId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to load account quality');
  }
};

export const dashboardOperationsHandler = async (req: Request, res: Response) => {
  try {
    const result = await getDashboardOperations(getWorkspaceId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to load operations dashboard');
  }
};

export const accountFailoverHandler = async (req: Request, res: Response) => {
  try {
    const result = await manualFailover(getUserId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to fail over account');
  }
};

export const accountRebalanceHandler = async (req: Request, res: Response) => {
  try {
    const result = await rebalanceAccount(getUserId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to rebalance account');
  }
};

export const accountResetDailyLimitHandler = async (req: Request, res: Response) => {
  try {
    const result = await resetDailyLimitNow(getUserId(req));
    res.json(result);
  } catch (err) {
    handleOperationsError(err, res, 'Failed to reset daily limit');
  }
};
