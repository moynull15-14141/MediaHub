import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Smartphone, RefreshCw, Unplug, Clock3, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface WhatsappAccount {
  id: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  businessName: string | null;
  qualityRating: string | null;
  healthStatus: 'HEALTHY' | 'WARNING' | 'UNHEALTHY' | 'UNKNOWN';
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastErrorMessage: string | null;
  lastSyncAt: string | null;
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

const statusBadge = (status: WhatsappAccount['status']) => {
  switch (status) {
    case 'CONNECTED':
      return <Badge variant="success">Connected</Badge>;
    case 'ERROR':
      return <Badge variant="danger">Error</Badge>;
    default:
      return <Badge variant="outline">Disconnected</Badge>;
  }
};

export default function WhatsappAccounts() {
  const { token } = useAuth();
  const { push } = useToast();
  const [account, setAccount] = useState<WhatsappAccount | null | undefined>(undefined);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '' });

  const load = async () => {
    try {
      const result = await whatsappFetch<WhatsappAccount | null>(token, '/account');
      setAccount(result);
    } catch (err: any) {
      push({ title: 'Failed to load account', description: err.message });
      setAccount(null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await whatsappFetch<WhatsappAccount>(token, '/account/connect', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setAccount(result);
      setConnectOpen(false);
      setForm({ phoneNumberId: '', wabaId: '', accessToken: '' });
      push({ title: 'Account connected', description: `${result.displayPhoneNumber || result.phoneNumberId} is now connected.` });
    } catch (err: any) {
      push({ title: 'Connection failed', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await whatsappFetch<WhatsappAccount>(token, '/account/refresh', { method: 'POST' });
      setAccount(result);
      push({ title: result.status === 'CONNECTED' ? 'Connection refreshed' : 'Connection error', description: result.lastErrorMessage || 'Account details updated.' });
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
      push({ title: 'Account disconnected', description: 'Your WhatsApp Business account has been removed.' });
    } catch (err: any) {
      push({ title: 'Disconnect failed', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Accounts</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Connect your Official WhatsApp Business Platform (Meta Cloud API) account.</p>
      </motion.div>

      {account === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : account ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
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
                  {statusBadge(account.status)}
                  {healthBadge(account.healthStatus)}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {account.lastErrorMessage && (
                <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{account.lastErrorMessage}</div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Phone number</p>
                  <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{account.displayPhoneNumber || '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Business name</p>
                  <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{account.businessName || '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Phone number ID</p>
                  <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{account.phoneNumberId}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">WABA ID</p>
                  <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{account.wabaId || '—'}</p>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Clock3 className="h-4 w-4 text-[var(--text-secondary)]" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    Last synced {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'never'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Refresh connection
                </Button>
                <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={() => setDisconnectOpen(true)}>
                  <Unplug className="mr-2 h-4 w-4" /> Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]">
                <Smartphone className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">No account connected</h3>
                <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">Connect your Official WhatsApp Business Platform account to start managing contacts.</p>
              </div>
              <Button onClick={() => setConnectOpen(true)}>Connect account</Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Dialog open={connectOpen} onClose={() => setConnectOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect WhatsApp Business account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleConnect} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Phone Number ID
              <Input value={form.phoneNumberId} onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))} placeholder="e.g. 109876543210123" required />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              WhatsApp Business Account ID (optional)
              <Input value={form.wabaId} onChange={(e) => setForm((f) => ({ ...f, wabaId: e.target.value }))} placeholder="e.g. 123456789012345" />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Access token
              <Input type="password" value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} placeholder="System user permanent token" required />
            </label>
            <p className="text-xs text-[var(--text-muted)]">Your access token is encrypted at rest and never shown again after saving.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConnectOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">This removes the connected WhatsApp account and its stored access token. Your contacts, groups, and labels are not affected.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDisconnect}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
