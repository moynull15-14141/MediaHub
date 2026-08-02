import { Request, Response } from 'express';
import { getUserId } from '../lib/require-auth';
import { getWorkspaceId } from '../lib/require-workspace';
import { getPublicMetaConfig, createOAuthState, MetaOAuthError } from '../services/meta-oauth.service';
import { completeEmbeddedSignup, MetaSignupError } from '../services/meta-signup.service';
import { syncAccount, listWorkspaceAccounts } from '../services/meta-sync.service';
import { validateAccount } from '../services/meta-validation.service';
import { WhatsappAccountError } from '../services/whatsapp-account.service';

const handleMetaError = (err: any, res: Response, fallback: string) => {
  if (err instanceof MetaOAuthError || err instanceof MetaSignupError || err instanceof WhatsappAccountError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
};

// Part 2/3: the frontend calls this right before opening the Facebook login
// popup - it returns only public identifiers (appId/configId, never a
// secret) plus a freshly minted, single-use state token to send back with
// the callback.
export const metaConfigHandler = async (req: Request, res: Response) => {
  try {
    const publicConfig = getPublicMetaConfig();
    if (!publicConfig.configured) {
      res.json({ ...publicConfig, state: null });
      return;
    }
    const state = await createOAuthState(getWorkspaceId(req), getUserId(req));
    res.json({ ...publicConfig, state });
  } catch (err) {
    handleMetaError(err, res, 'Failed to load Meta configuration');
  }
};

// Part 3/4/5/6: receives the authorization code + Embedded Signup session
// data from the frontend after FB.login succeeds, validates it, exchanges it
// server-side only, and stores the connected account.
export const metaCallbackHandler = async (req: Request, res: Response) => {
  try {
    const account = await completeEmbeddedSignup(getWorkspaceId(req), getUserId(req), req.body);
    res.status(201).json(account);
  } catch (err) {
    handleMetaError(err, res, 'Failed to complete WhatsApp Embedded Signup');
  }
};

export const metaSyncHandler = async (req: Request, res: Response) => {
  try {
    const account = await syncAccount(getWorkspaceId(req), getUserId(req));
    res.json(account);
  } catch (err) {
    handleMetaError(err, res, 'Failed to sync account');
  }
};

export const metaValidateHandler = async (req: Request, res: Response) => {
  try {
    const result = await validateAccount(getWorkspaceId(req), getUserId(req));
    res.json(result);
  } catch (err) {
    handleMetaError(err, res, 'Failed to validate account');
  }
};

export const listWorkspaceAccountsHandler = async (req: Request, res: Response) => {
  try {
    const accounts = await listWorkspaceAccounts(getWorkspaceId(req));
    res.json(accounts);
  } catch (err) {
    handleMetaError(err, res, 'Failed to load workspace accounts');
  }
};
