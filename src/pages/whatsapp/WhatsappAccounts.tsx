import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Smartphone, RefreshCw, Unplug, Clock3, ShieldCheck, AlertTriangle, Facebook, BadgeCheck, ShieldQuestion } from 'lucide-react';
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
}

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
  const { can } = usePermissions();
  const canManage = can('settings:write');
  const { connect, connecting } = useFacebookEmbeddedSignup();

  const [accounts, setAccounts] = useState<WhatsappAccount[] | undefined>(undefined);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'sync' | 'validate' | 'disconnect' | null>(null);

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
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {connectionBadge(account.connectionHealth)}
                        {healthBadge(account.healthStatus)}
                        {sourceBadge(account.connectionSource)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {account.lastErrorMessage && (
                      <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{account.lastErrorMessage}</div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Business name" value={account.businessName} />
                      <Field label="Verified name" value={account.verifiedName} />
                      <Field label="Display phone number" value={account.displayPhoneNumber} />
                      <Field label="Phone number ID" value={account.phoneNumberId} />
                      <Field label="WABA ID" value={account.wabaId} />
                      <Field label="Business ID" value={account.metaBusinessId} />
                      <Field label="Status" value={account.status} />
                      <Field label="Quality rating" value={account.qualityRating} />
                      <Field label="Messaging tier" value={account.messagingLimitTier} />
                      <Field label="Connected at" value={new Date(account.createdAt).toLocaleString()} />
                      <Field label="Last sync" value={account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'never'} />
                      <Field label="Last validation" value={account.lastValidationAt ? new Date(account.lastValidationAt).toLocaleString() : 'never'} />
                    </div>
                    {isMine && canManage && (
                      <div className="flex flex-wrap gap-3 pt-2">
                        <Button variant="outline" onClick={handleSync} disabled={busyAction !== null}>
                          <RefreshCw className={busyAction === 'sync' ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Sync
                        </Button>
                        <Button variant="outline" onClick={handleValidate} disabled={busyAction !== null}>
                          <ShieldCheck className="mr-2 h-4 w-4" /> Validate
                        </Button>
                        <Button variant="outline" onClick={handleConnect} disabled={connecting}>
                          <Facebook className="mr-2 h-4 w-4" /> Reconnect
                        </Button>
                        <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={() => setDisconnectOpen(true)} disabled={busyAction !== null}>
                          <Unplug className="mr-2 h-4 w-4" /> Disconnect
                        </Button>
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
