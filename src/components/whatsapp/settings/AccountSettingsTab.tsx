import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Unplug, ExternalLink, ShieldCheck, AlertTriangle, KeyRound, Webhook as WebhookIcon } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { usePermissions } from '@/src/hooks/usePermissions';

interface AccountInfo {
  businessName: string | null;
  displayPhoneNumber: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  businessManagerId: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  healthStatus: 'HEALTHY' | 'WARNING' | 'UNHEALTHY' | 'UNKNOWN';
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  webhookVerified: boolean;
  lastSyncAt: string | null;
  lastErrorMessage: string | null;
}

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p>
    <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{value ?? '—'}</p>
  </div>
);

export function AccountSettingsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canManage = can('settings:write');
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const load = async () => {
    try {
      const result = await whatsappFetch<AccountInfo | null>(token, '/account');
      setAccount(result);
    } catch (err: any) {
      push({ title: 'Failed to load account', description: err.message });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await whatsappFetch<AccountInfo>(token, '/account/refresh', { method: 'POST' });
      setAccount(result);
      push({ title: 'Connection refreshed' });
    } catch (err: any) {
      push({ title: 'Refresh failed', description: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await whatsappFetch(token, '/account/disconnect', { method: 'POST' });
      setAccount(null);
      setDisconnectOpen(false);
      push({ title: 'Account disconnected' });
    } catch (err: any) {
      push({ title: 'Disconnect failed', description: err.message });
    }
  };

  if (account === undefined) return <Skeleton className="h-64 w-full" />;

  if (!account) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-sm text-[var(--text-muted)]">No WhatsApp account connected yet.</p>
          <Button onClick={() => navigate('/whatsapp/accounts')}>Connect account</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-6">
          {account.lastErrorMessage && (
            <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{account.lastErrorMessage}</div>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant={account.status === 'CONNECTED' ? 'success' : account.status === 'ERROR' ? 'danger' : 'outline'}>{account.status}</Badge>
            <Badge variant={account.healthStatus === 'HEALTHY' ? 'success' : account.healthStatus === 'WARNING' ? 'warning' : account.healthStatus === 'UNHEALTHY' ? 'danger' : 'outline'}>
              {account.healthStatus === 'HEALTHY' ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} Quality: {account.qualityRating || 'Unknown'}
            </Badge>
            <Badge variant={account.webhookVerified ? 'success' : 'outline'}><WebhookIcon className="h-3.5 w-3.5" /> Webhook {account.webhookVerified ? 'verified' : 'unverified'}</Badge>
            <Badge variant="outline"><KeyRound className="h-3.5 w-3.5" /> Token encrypted &amp; stored</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Business name" value={account.businessName} />
            <Field label="Display phone number" value={account.displayPhoneNumber} />
            <Field label="Phone number ID" value={account.phoneNumberId} />
            <Field label="WABA ID" value={account.wabaId} />
            <Field label="Business Manager ID" value={account.businessManagerId} />
            <Field label="Messaging limit" value={account.messagingLimitTier} />
            <Field label="Last synced" value={account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'never'} />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing || !canManage}>
              <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Refresh
            </Button>
            <Button variant="outline" onClick={() => navigate('/whatsapp/accounts')} disabled={!canManage}>
              <ExternalLink className="mr-2 h-4 w-4" /> Reconnect
            </Button>
            <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={() => setDisconnectOpen(true)} disabled={!canManage}>
              <Unplug className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </div>
          {!canManage && (
            <p className="text-xs text-[var(--text-muted)]">Your role does not have permission to manage this account.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disconnect account?</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">This removes the connected account and its stored access token.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDisconnect}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
