import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Smartphone, RefreshCw, Unplug, Clock3, ShieldCheck, AlertTriangle, Facebook, BadgeCheck, ShieldQuestion, Star, PowerOff, Power, PlayCircle, XCircle, Webhook, Radio } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { usePermissions } from '@/src/hooks/usePermissions';
import { useFacebookEmbeddedSignup } from '@/src/hooks/useFacebookEmbeddedSignup';
import { QualityBadge } from '@/src/components/whatsapp/QualityBadge';

interface WhatsappAccount {
  id: string;
  userId: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  businessName: string | null;
  verifiedName: string | null;
  metaBusinessId: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  healthStatus: 'HEALTHY' | 'WARNING' | 'UNHEALTHY' | 'UNKNOWN';
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectionSource: 'MANUAL' | 'META_EMBEDDED_SIGNUP';
  connectionHealth: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'PERMISSION_ERROR';
  lastErrorMessage: string | null;
  lastSyncAt: string | null;
  lastValidationAt: string | null;
  lastValidationStatus: string | null;
  createdAt: string;
  // Phase B.2 - Production Multi-Account Engine
  isDefault: boolean;
  priority: number;
  messagingLimit: number | null;
  sendingEnabled: boolean;
  dailyLimit: number | null;
  currentDailySent: number;
  lastHealthCheck: string | null;
  lastWebhookSync: string | null;
  webhookSubscribed: boolean;
  tokenExpiringSoon: boolean;
  pendingJobCount: number;
  // Phase B.3 - Token Lifecycle Automation
  tokenStatus: 'CONNECTED' | 'EXPIRING' | 'EXPIRED' | 'INVALID' | 'RECONNECT_REQUIRED' | 'PERMISSION_REVOKED' | 'DISCONNECTED';
  consecutiveValidationFailures: number;
  validationLatency: number | null;
  lastSuccessfulValidation: string | null;
  lastFailedValidation: string | null;
  validationFailureReason: string | null;
  // Phase B.4 - Webhook Automation & Delivery Reliability
  webhookVerifiedAt: string | null;
  webhookVerificationError: string | null;
  webhookSubscriptionError: string | null;
  webhookHealthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
  webhookLastPingAt: string | null;
  webhookLastDeliveryAt: string | null;
  webhookHealth: {
    lastReceivedAt: string | null;
    eventsPerHour: number;
    eventsToday: number;
    averageProcessingTimeMs: number | null;
    failureRate: number;
    signatureFailures24h: number;
    retryCount: number;
    deadLetters: number;
  } | null;
}

const RECONNECT_NEEDED_STATES = new Set(['RECONNECT_REQUIRED', 'PERMISSION_REVOKED', 'INVALID']);

const tokenStatusBadge = (status: WhatsappAccount['tokenStatus']) => {
  switch (status) {
    case 'CONNECTED':
      return <Badge variant="success"><BadgeCheck className="h-3.5 w-3.5" /> Token connected</Badge>;
    case 'EXPIRING':
      return <Badge variant="warning"><Clock3 className="h-3.5 w-3.5" /> Token expiring</Badge>;
    case 'EXPIRED':
      return <Badge variant="warning"><AlertTriangle className="h-3.5 w-3.5" /> Token expired</Badge>;
    case 'RECONNECT_REQUIRED':
      return <Badge variant="danger"><XCircle className="h-3.5 w-3.5" /> Reconnect required</Badge>;
    case 'PERMISSION_REVOKED':
      return <Badge variant="danger"><ShieldQuestion className="h-3.5 w-3.5" /> Permission revoked</Badge>;
    case 'INVALID':
      return <Badge variant="danger"><XCircle className="h-3.5 w-3.5" /> Token invalid</Badge>;
    default:
      return <Badge variant="outline">Token disconnected</Badge>;
  }
};

const healthBadge = (health: WhatsappAccount['healthStatus']) => {
  switch (health) {
    case 'HEALTHY':
      return <Badge variant="success"><ShieldCheck className="h-3.5 w-3.5" /> Healthy</Badge>;
    case 'WARNING':
      return <Badge variant="warning"><AlertTriangle className="h-3.5 w-3.5" /> Warning</Badge>;
    case 'UNHEALTHY':
      return <Badge variant="danger"><AlertTriangle className="h-3.5 w-3.5" /> Unhealthy</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
};

const connectionBadge = (health: WhatsappAccount['connectionHealth']) => {
  switch (health) {
    case 'CONNECTED':
      return <Badge variant="success"><BadgeCheck className="h-3.5 w-3.5" /> Connected</Badge>;
    case 'EXPIRED':
      return <Badge variant="warning"><AlertTriangle className="h-3.5 w-3.5" /> Expired</Badge>;
    case 'PERMISSION_ERROR':
      return <Badge variant="danger"><ShieldQuestion className="h-3.5 w-3.5" /> Permission error</Badge>;
    default:
      return <Badge variant="outline">Disconnected</Badge>;
  }
};

const webhookHealthBadge = (status: WhatsappAccount['webhookHealthStatus']) => {
  switch (status) {
    case 'HEALTHY':
      return <Badge variant="success"><Radio className="h-3.5 w-3.5" /> Webhook healthy</Badge>;
    case 'WARNING':
      return <Badge variant="warning"><AlertTriangle className="h-3.5 w-3.5" /> Webhook warning</Badge>;
    case 'CRITICAL':
      return <Badge variant="danger"><AlertTriangle className="h-3.5 w-3.5" /> Webhook critical</Badge>;
    default:
      return <Badge variant="outline"><Webhook className="h-3.5 w-3.5" /> Webhook unknown</Badge>;
  }
};

const sourceBadge = (source: WhatsappAccount['connectionSource']) =>
  source === 'META_EMBEDDED_SIGNUP' ? (
    <Badge variant="outline"><Facebook className="h-3.5 w-3.5" /> Connected via Facebook</Badge>
  ) : (
    <Badge variant="outline">Manually connected</Badge>
  );

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p>
    <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{value ?? '—'}</p>
  </div>
);

export default function WhatsappAccounts() {
  const { token, user } = useAuth();
  const { push } = useToast();
  const { can, role } = usePermissions();
  const canManage = can('settings:write');
  const isWorkspaceAdmin = role === 'OWNER' || role === 'ADMIN';
  const { connect, connecting } = useFacebookEmbeddedSignup();

  const [accounts, setAccounts] = useState<WhatsappAccount[] | undefined>(undefined);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'sync' | 'validate' | 'disconnect' | 'default' | 'sending' | 'resume' | 'webhookVerify' | 'webhookReRegister' | null>(null);

  const load = async () => {
    try {
      const result = await whatsappFetch<WhatsappAccount[]>(token, '/account/meta/workspace-accounts');
      setAccounts(result);
    } catch (err: any) {
      push({ title: 'Failed to load accounts', description: err.message });
      setAccounts([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myAccount = accounts?.find((a) => a.userId === user?.id) ?? null;

  const handleConnect = async () => {
    try {
      const result = await connect();
      push({ title: 'WhatsApp connected', description: `${result.displayPhoneNumber || 'Your number'} is now connected via Facebook.` });
      await load();
    } catch (err: any) {
      push({ title: 'Connection failed', description: err.message });
    }
  };

  const handleSync = async () => {
    setBusyAction('sync');
    try {
      await whatsappFetch(token, '/account/meta/sync', { method: 'POST' });
      push({ title: 'Account synced', description: 'Business profile and phone number details are up to date.' });
      await load();
    } catch (err: any) {
      push({ title: 'Sync failed', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleValidate = async () => {
    setBusyAction('validate');
    try {
      const result = await whatsappFetch<{ validation: { health: string; message: string } }>(token, '/account/meta/validate', { method: 'POST' });
      push({ title: `Validation: ${result.validation.health}`, description: result.validation.message });
      await load();
    } catch (err: any) {
      push({ title: 'Validation failed', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  // Phase B.3 - manual trigger so a user who just fixed/reconnected doesn't
  // have to wait up to 30 minutes for the health scheduler's next tick to
  // auto-resume campaigns it auto-paused.
  const handleResume = async () => {
    setBusyAction('resume');
    try {
      const result = await whatsappFetch<{ resumedCount: number }>(token, '/account/resume', { method: 'POST' });
      push({ title: result.resumedCount > 0 ? `Resumed ${result.resumedCount} campaign(s)` : 'Nothing to resume', description: result.resumedCount > 0 ? 'Auto-paused campaigns on this account are sending again.' : undefined });
      await load();
    } catch (err: any) {
      push({ title: 'Failed to resume campaigns', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  // Phase B.4 - on-demand self-check against Meta's own subscribed_apps
  // record, distinct from the passive GET /webhook challenge Meta drives.
  const handleWebhookVerify = async () => {
    setBusyAction('webhookVerify');
    try {
      const result = await whatsappFetch<{ subscribed: boolean }>(token, '/account/webhook/verify', { method: 'POST' });
      push({ title: result.subscribed ? 'Webhook is subscribed' : 'Webhook is not subscribed', description: result.subscribed ? 'Meta confirms this app is receiving webhook events for this account.' : 'Try Re-register, or reconnect the account.' });
      await load();
    } catch (err: any) {
      push({ title: 'Webhook verification failed', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleWebhookReRegister = async () => {
    setBusyAction('webhookReRegister');
    try {
      const result = await whatsappFetch<{ subscribed: boolean; error?: string }>(token, '/account/webhook/re-register', { method: 'POST' });
      push({ title: result.subscribed ? 'Webhook re-registered' : 'Webhook registration failed', description: result.subscribed ? undefined : result.error });
      await load();
    } catch (err: any) {
      push({ title: 'Failed to re-register webhook', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnect = async () => {
    setBusyAction('disconnect');
    try {
      await whatsappFetch(token, '/account/disconnect', { method: 'POST' });
      setDisconnectOpen(false);
      push({ title: 'Account disconnected', description: 'Your WhatsApp Business account has been removed.' });
      await load();
    } catch (err: any) {
      push({ title: 'Disconnect failed', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  // Phase B.2 - act on ANY account in the workspace (Owner/Admin only), not
  // just the caller's own - distinct from the self-only actions above.
  const handleSetDefault = async (accountId: string) => {
    setBusyAction('default');
    try {
      await whatsappFetch(token, `/account/${accountId}/default`, { method: 'PATCH' });
      push({ title: 'Default account updated' });
      await load();
    } catch (err: any) {
      push({ title: 'Failed to set default account', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleSending = async (accountId: string, enabled: boolean) => {
    setBusyAction('sending');
    try {
      await whatsappFetch(token, `/account/${accountId}/sending`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      push({ title: enabled ? 'Sending enabled' : 'Sending disabled', description: enabled ? undefined : 'Any campaigns currently sending on this account were paused.' });
      await load();
    } catch (err: any) {
      push({ title: 'Failed to update sending status', description: err.message });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Accounts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            Connect your Official WhatsApp Business Platform (Meta Cloud API) account. Every account connected by a workspace member appears below.
          </p>
        </div>
        {canManage && (
          <Button onClick={handleConnect} disabled={connecting}>
            <Facebook className="mr-2 h-4 w-4" /> {connecting ? 'Connecting…' : myAccount ? 'Reconnect with Facebook' : 'Continue with Facebook'}
          </Button>
        )}
      </motion.div>

      {accounts === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : accounts.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]">
                <Smartphone className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">No account connected</h3>
                <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">
                  Connect your Official WhatsApp Business Platform account with Facebook to start managing contacts. No manual token or ID entry required.
                </p>
              </div>
              {canManage ? (
                <Button onClick={handleConnect} disabled={connecting}>
                  <Facebook className="mr-2 h-4 w-4" /> {connecting ? 'Connecting…' : 'Continue with Facebook'}
                </Button>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">Your role does not have permission to connect an account.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => {
            const isMine = account.userId === user?.id;
            return (
              <motion.div key={account.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                          <Smartphone className="h-5 w-5" />
                        </div>
                        <CardTitle className="text-lg">{account.businessName || 'WhatsApp Business Account'}</CardTitle>
                        {account.isDefault && (
                          <Badge variant="outline"><Star className="h-3.5 w-3.5" /> Default</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {connectionBadge(account.connectionHealth)}
                        {tokenStatusBadge(account.tokenStatus)}
                        {healthBadge(account.healthStatus)}
                        {webhookHealthBadge(account.webhookHealthStatus)}
                        {sourceBadge(account.connectionSource)}
                        {!account.sendingEnabled && (
                          <Badge variant="danger"><PowerOff className="h-3.5 w-3.5" /> Sending disabled</Badge>
                        )}
                        {account.tokenExpiringSoon && (
                          <Badge variant="warning"><Clock3 className="h-3.5 w-3.5" /> Token expiring soon</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {account.lastErrorMessage && (
                      <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{account.lastErrorMessage}</div>
                    )}
                    {isMine && RECONNECT_NEEDED_STATES.has(account.tokenStatus) && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        <div>
                          <p className="font-medium">This account needs attention: {account.tokenStatus.replace(/_/g, ' ').toLowerCase()}</p>
                          <p className="mt-1 text-xs text-amber-200/80">{account.validationFailureReason || 'Reconnect to restore sending.'}</p>
                        </div>
                        {canManage && (
                          <Button size="sm" onClick={handleConnect} disabled={connecting}>
                            <Facebook className="mr-2 h-4 w-4" /> Reconnect now
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Business name" value={account.businessName} />
                      <Field label="Verified name" value={account.verifiedName} />
                      <Field label="Display phone number" value={account.displayPhoneNumber} />
                      <Field label="Phone number ID" value={account.phoneNumberId} />
                      <Field label="WABA ID" value={account.wabaId} />
                      <Field label="Business ID" value={account.metaBusinessId} />
                      <Field label="Status" value={account.status} />
                      <Field label="Quality rating" value={<QualityBadge rating={account.qualityRating} />} />
                      <Field label="Messaging tier" value={account.messagingLimitTier} />
                      <Field label="Connected at" value={new Date(account.createdAt).toLocaleString()} />
                      <Field label="Last sync" value={account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'never'} />
                      <Field label="Last validation" value={account.lastValidationAt ? new Date(account.lastValidationAt).toLocaleString() : 'never'} />
                      <Field label="Last health check" value={account.lastHealthCheck ? new Date(account.lastHealthCheck).toLocaleString() : 'never'} />
                      <Field label="Webhook subscribed" value={account.webhookSubscribed ? 'Yes' : 'No'} />
                      <Field label="Daily usage" value={`${account.currentDailySent} / ${account.dailyLimit ?? '∞'}`} />
                      <Field label="Current queue" value={account.pendingJobCount} />
                      <Field label="Last successful validation" value={account.lastSuccessfulValidation ? new Date(account.lastSuccessfulValidation).toLocaleString() : 'never'} />
                      <Field label="Last failed validation" value={account.lastFailedValidation ? new Date(account.lastFailedValidation).toLocaleString() : 'never'} />
                      <Field label="Validation latency" value={account.validationLatency != null ? `${account.validationLatency}ms` : '—'} />
                      <Field label="Consecutive failures" value={account.consecutiveValidationFailures} />
                    </div>
                    <div className="border-t border-[var(--border)] pt-4">
                      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Webhook health</p>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label="Webhook verified" value={account.webhookVerified ? 'Yes' : 'No'} />
                        <Field label="Webhook status" value={account.webhookHealthStatus} />
                        <Field label="Last event" value={account.webhookLastPingAt ? new Date(account.webhookLastPingAt).toLocaleString() : 'never'} />
                        <Field label="Last delivery" value={account.webhookLastDeliveryAt ? new Date(account.webhookLastDeliveryAt).toLocaleString() : 'never'} />
                        <Field label="Events today" value={account.webhookHealth?.eventsToday ?? 0} />
                        <Field label="Avg processing time" value={account.webhookHealth?.averageProcessingTimeMs != null ? `${account.webhookHealth.averageProcessingTimeMs}ms` : '—'} />
                        <Field label="Retries" value={account.webhookHealth?.retryCount ?? 0} />
                        <Field label="Dead letters" value={account.webhookHealth?.deadLetters ?? 0} />
                        <Field label="Signature errors (24h)" value={account.webhookHealth?.signatureFailures24h ?? 0} />
                      </div>
                      {(account.webhookVerificationError || account.webhookSubscriptionError) && (
                        <div className="mt-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                          {account.webhookSubscriptionError || account.webhookVerificationError}
                        </div>
                      )}
                    </div>
                    {isMine && canManage && (
                      <div className="flex flex-wrap gap-3 pt-2">
                        <Button variant="outline" onClick={handleSync} disabled={busyAction !== null}>
                          <RefreshCw className={busyAction === 'sync' ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Sync
                        </Button>
                        <Button variant="outline" onClick={handleValidate} disabled={busyAction !== null}>
                          <ShieldCheck className="mr-2 h-4 w-4" /> Validate
                        </Button>
                        <Button variant="outline" onClick={handleWebhookVerify} disabled={busyAction !== null}>
                          <Webhook className={busyAction === 'webhookVerify' ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Verify webhook
                        </Button>
                        <Button variant="outline" onClick={handleWebhookReRegister} disabled={busyAction !== null}>
                          <Radio className={busyAction === 'webhookReRegister' ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Re-register webhook
                        </Button>
                        <Button variant="outline" onClick={handleConnect} disabled={connecting}>
                          <Facebook className="mr-2 h-4 w-4" /> Reconnect
                        </Button>
                        <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={() => setDisconnectOpen(true)} disabled={busyAction !== null}>
                          <Unplug className="mr-2 h-4 w-4" /> Disconnect
                        </Button>
                        {account.tokenStatus === 'CONNECTED' && (
                          <Button variant="outline" onClick={handleResume} disabled={busyAction !== null}>
                            <PlayCircle className="mr-2 h-4 w-4" /> Resume paused campaigns
                          </Button>
                        )}
                      </div>
                    )}
                    {isMine && !canManage && (
                      <p className="text-xs text-[var(--text-muted)]">Your role does not have permission to manage this account.</p>
                    )}
                    {!isMine && (
                      <div className="flex items-center gap-2 pt-1 text-xs text-[var(--text-muted)]">
                        <Clock3 className="h-3.5 w-3.5" /> Connected by another workspace member
                      </div>
                    )}
                    {isWorkspaceAdmin && (
                      <div className="flex flex-wrap gap-3 border-t border-[var(--border)] pt-3">
                        <Button
                          variant="outline"
                          onClick={() => handleSetDefault(account.id)}
                          disabled={busyAction !== null || account.isDefault}
                        >
                          <Star className="mr-2 h-4 w-4" /> {account.isDefault ? 'Default account' : 'Set as default'}
                        </Button>
                        {account.sendingEnabled ? (
                          <Button
                            variant="outline"
                            className="text-rose-300 hover:bg-rose-500/10"
                            onClick={() => handleToggleSending(account.id, false)}
                            disabled={busyAction !== null}
                          >
                            <PowerOff className="mr-2 h-4 w-4" /> Disable sending
                          </Button>
                        ) : (
                          <Button variant="outline" onClick={() => handleToggleSending(account.id, true)} disabled={busyAction !== null}>
                            <Power className="mr-2 h-4 w-4" /> Enable sending
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">This removes the connected WhatsApp account and its stored access token. Your contacts, groups, and labels are not affected.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDisconnect} disabled={busyAction === 'disconnect'}>
              {busyAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
