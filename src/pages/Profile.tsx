import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { UserCircle, KeyRound, ShieldCheck, History as HistoryIcon, LogOut } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Badge } from '@/src/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { authFetch } from '@/src/lib/api';

interface LoginHistoryEntry {
  id: string;
  event: string;
  ipAddress: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  reason: string | null;
  createdAt: string;
}

const EVENT_BADGE: Record<string, 'success' | 'warning' | 'danger' | 'outline'> = {
  LOGIN: 'success',
  REGISTER: 'success',
  TOKEN_REFRESH: 'outline',
  LOGOUT: 'outline',
  LOGOUT_ALL: 'outline',
  LOGIN_FAILED: 'danger',
  PASSWORD_CHANGE: 'warning',
};

export default function Profile() {
  const { token, user, setUser, logout } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [history, setHistory] = useState<LoginHistoryEntry[] | undefined>(undefined);

  useEffect(() => {
    authFetch<LoginHistoryEntry[]>(token, '/login-history?limit=20')
      .then(setHistory)
      .catch((err: any) => push({ title: 'Failed to load login history', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingName(true);
    try {
      const updated = await authFetch<{ id: string; email: string; name: string | null }>(token, '/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setUser({ ...user!, name: updated.name });
      push({ title: 'Profile updated' });
    } catch (err: any) {
      push({ title: 'Failed to update profile', description: err.message });
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      push({ title: 'Passwords do not match', description: 'New password and confirmation must be the same.' });
      return;
    }
    setChangingPassword(true);
    try {
      await authFetch(token, '/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      push({ title: 'Password changed successfully' });
    } catch (err: any) {
      push({ title: 'Failed to change password', description: err.message });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLogoutAll = async () => {
    setLoggingOutAll(true);
    try {
      const result = await authFetch<{ revokedCount: number }>(token, '/logout-all', { method: 'POST' });
      push({ title: `Logged out of ${result.revokedCount} session(s)`, description: 'You will need to log in again here too.' });
      logout();
      navigate('/login');
    } catch (err: any) {
      push({ title: 'Failed to log out of all devices', description: err.message });
    } finally {
      setLoggingOutAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Profile</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Manage your account details, password, and active sessions.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                <UserCircle className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Account information</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveName} className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Email address</p>
                <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{user?.email}</p>
              </div>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Display name
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={100} />
              </label>
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Member since</p>
                <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{user?.createdAt ? new Date(user.createdAt).toLocaleString() : '—'}</p>
              </div>
              <Button type="submit" disabled={savingName}>{savingName ? 'Saving…' : 'Save changes'}</Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                <KeyRound className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Change password</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Current password
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                New password
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Confirm new password
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required />
              </label>
              <Button type="submit" disabled={changingPassword}>{changingPassword ? 'Changing…' : 'Change password'}</Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Sessions</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">Sign out of this device and every other device where you're logged in.</p>
            <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={handleLogoutAll} disabled={loggingOutAll}>
              <LogOut className="mr-2 h-4 w-4" /> {loggingOutAll ? 'Logging out…' : 'Log out of all devices'}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                <HistoryIcon className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Login history</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {history === undefined ? (
              <Skeleton className="h-32 w-full" />
            ) : history.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="No history yet" description="Sign-in activity will appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>IP address</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell><Badge variant={EVENT_BADGE[entry.event] ?? 'outline'}>{entry.event.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell>{[entry.browser, entry.os, entry.deviceType].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell>{entry.ipAddress || '—'}</TableCell>
                      <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
