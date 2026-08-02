import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, RotateCw, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface SecurityInfo {
  hasToken: boolean;
  tokenCreatedAt: string | null;
  tokenUpdatedAt: string | null;
  sessionTimeoutSeconds: number;
  activeSessionsNote: string;
}

interface AuditEntry { id: string; action: string; detail: string | null; createdAt: string; }

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');

export function SecurityTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [info, setInfo] = useState<SecurityInfo | undefined>(undefined);
  const [logs, setLogs] = useState<AuditEntry[] | undefined>(undefined);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateForm, setRotateForm] = useState({ accessToken: '', phoneNumberId: '' });
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    try {
      const [security, audit] = await Promise.all([
        whatsappFetch<SecurityInfo>(token, '/account/security'),
        whatsappFetch<{ logs: AuditEntry[] }>(token, '/account/audit-logs?page=1&pageSize=20'),
      ]);
      setInfo(security);
      setLogs(audit.logs);
    } catch (err: any) {
      push({ title: 'Failed to load security info', description: err.message });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRotating(true);
    try {
      await whatsappFetch(token, '/account/rotate-token', { method: 'POST', body: JSON.stringify(rotateForm) });
      push({ title: 'Token rotated', description: 'The new token is encrypted and stored.' });
      setRotateOpen(false);
      setRotateForm({ accessToken: '', phoneNumberId: '' });
      load();
    } catch (err: any) {
      push({ title: 'Rotation failed', description: err.message });
    } finally {
      setRotating(false);
    }
  };

  if (info === undefined) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><ShieldCheck className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Token &amp; session security</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Access token</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><KeyRound className="h-4 w-4" /> {info.hasToken ? 'Encrypted & stored (AES-256-GCM)' : 'Not set'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Token created / updated</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{fmt(info.tokenCreatedAt)} / {fmt(info.tokenUpdatedAt)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Session timeout</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{Math.round(info.sessionTimeoutSeconds / 3600)} hours</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Active sessions</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{info.activeSessionsNote}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setRotateOpen(true)} disabled={!info.hasToken}><RotateCw className="mr-2 h-4 w-4" /> Rotate token</Button>
          {!info.hasToken && <p className="text-xs text-[var(--text-muted)]">Connect a WhatsApp account first to rotate its token.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><History className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Audit log</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {logs === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : logs.length === 0 ? (
            <EmptyState icon={History} title="No activity yet" description="Actions like connecting, rotating tokens, and campaign sends will appear here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Action</TableHead><TableHead>Detail</TableHead><TableHead>When</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.action}</TableCell>
                    <TableCell className="text-[var(--text-secondary)]">{l.detail || '—'}</TableCell>
                    <TableCell>{new Date(l.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={rotateOpen} onClose={() => setRotateOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate access token</DialogTitle></DialogHeader>
          <form onSubmit={handleRotate} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              New access token
              <Input type="password" value={rotateForm.accessToken} onChange={(e) => setRotateForm({ ...rotateForm, accessToken: e.target.value })} required />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Phone number ID
              <Input value={rotateForm.phoneNumberId} onChange={(e) => setRotateForm({ ...rotateForm, phoneNumberId: e.target.value })} required />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRotateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={rotating}>{rotating ? 'Rotating…' : 'Rotate token'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
