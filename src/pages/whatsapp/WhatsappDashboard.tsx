import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Smartphone, Users, FolderKanban, Tag, Upload, Activity, ShieldCheck, ListOrdered, Send, XOctagon, Clock3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface DashboardData {
  account: { status: string; displayPhoneNumber: string | null; businessName: string | null; healthStatus: string } | null;
  totalContacts: number;
  totalGroups: number;
  totalLabels: number;
  recentImports: { id: string; filename: string | null; source: string; totalRows: number; importedCount: number; duplicateCount: number; invalidCount: number; skippedCount: number; createdAt: string }[];
}

// Phase B.5 - Production Operations & Multi-Tenant Reliability. Backed by
// GET /dashboard/operations (operations.service.ts's getDashboardOperations),
// a separate additive call from the pre-existing GET /dashboard above - the
// original dashboard payload/cost is unchanged for any existing caller.
interface OperationsData {
  connectedAccounts: number;
  healthyAccounts: number;
  totalAccounts: number;
  queueSize: number;
  todaySends: number;
  todayFailures: number;
  dailyUsage: { accountId: string; businessName: string | null; dailyLimit: number | null; sentToday: number; withinLimit: boolean; remaining: number | null }[];
  rateLimit: { accountId: string; businessName: string | null; sentLastMinute: number; effectiveLimitPerMinute: number; throttled: boolean }[];
  quality: { accountId: string; businessName: string | null; qualityRating: string | null; healthStatus: string; messagingLimitTier: string | null }[];
  webhook: { HEALTHY: number; WARNING: number; CRITICAL: number; UNKNOWN: number };
  upcomingExpiry: { accountId: string; businessName: string | null; tokenExpiresAt: string | null }[];
  campaignDistribution: { accountId: string; businessName: string | null; activeCampaigns: number }[];
  schedulers: { name: string; running: boolean; lastTickAt: string | null; lastDurationMs: number | null; lastError: string | null; totalRuns: number; totalFailures: number }[];
}

const webhookBadgeVariant = (level: keyof OperationsData['webhook']): 'success' | 'warning' | 'danger' | 'outline' => {
  if (level === 'HEALTHY') return 'success';
  if (level === 'WARNING') return 'warning';
  if (level === 'CRITICAL') return 'danger';
  return 'outline';
};

export default function WhatsappDashboard() {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<DashboardData | undefined>(undefined);
  const [ops, setOps] = useState<OperationsData | undefined>(undefined);

  useEffect(() => {
    whatsappFetch<DashboardData>(token, '/dashboard')
      .then(setData)
      .catch((err) => push({ title: 'Failed to load dashboard', description: err.message }));
    whatsappFetch<OperationsData>(token, '/dashboard/operations')
      .then(setOps)
      .catch((err) => push({ title: 'Failed to load operations', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = data
    ? [
        { label: 'Total contacts', value: data.totalContacts, icon: Users },
        { label: 'Total groups', value: data.totalGroups, icon: FolderKanban },
        { label: 'Total labels', value: data.totalLabels, icon: Tag },
      ]
    : [];

  const opsStats = ops
    ? [
        { label: 'Connected accounts', value: `${ops.connectedAccounts} / ${ops.totalAccounts}`, icon: Smartphone },
        { label: 'Healthy accounts', value: ops.healthyAccounts, icon: ShieldCheck },
        { label: 'Queue size', value: ops.queueSize, icon: ListOrdered },
        { label: "Today's sends", value: ops.todaySends, icon: Send },
        { label: "Today's failures", value: ops.todayFailures, icon: XOctagon },
      ]
    : [];

  // Merge the per-account operations arrays by accountId into one row per
  // account for the table below - purely a client-side join over data
  // that's already fetched, not an extra request.
  const accountRows = ops
    ? ops.dailyUsage.map((usage) => {
        const rate = ops.rateLimit.find((r) => r.accountId === usage.accountId);
        const quality = ops.quality.find((q) => q.accountId === usage.accountId);
        const distribution = ops.campaignDistribution.find((d) => d.accountId === usage.accountId);
        return { ...usage, rate, quality, activeCampaigns: distribution?.activeCampaigns ?? 0 };
      })
    : [];

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">WhatsApp Campaign</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Overview of your connected account and contact database.</p>
      </motion.div>

      {data === undefined ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i}><Skeleton className="h-32 w-full" /></div>)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <CardContent className="flex items-center justify-between p-6">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Connected account</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{data.account?.displayPhoneNumber || 'Not connected'}</p>
                    {data.account && <Badge variant={data.account.status === 'CONNECTED' ? 'success' : 'danger'} className="mt-2">{data.account.status}</Badge>}
                  </div>
                  <Smartphone className="h-8 w-8 text-[var(--text-secondary)]" />
                </CardContent>
              </Card>
            </motion.div>
            {stats.map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * (i + 1) }}>
                <Card>
                  <CardContent className="flex items-center justify-between p-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{stat.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{stat.value}</p>
                    </div>
                    <stat.icon className="h-8 w-8 text-[var(--text-secondary)]" />
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Phase B.5 - Operations Engine summary row */}
          {ops && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {opsStats.map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * (i + 1) }}>
                  <Card>
                    <CardContent className="flex items-center justify-between p-6">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{stat.label}</p>
                        <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{stat.value}</p>
                      </div>
                      <stat.icon className="h-8 w-8 text-[var(--text-secondary)]" />
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {ops && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                        <Activity className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-lg">Account operations</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={webhookBadgeVariant('HEALTHY')}>{ops.webhook.HEALTHY} webhook healthy</Badge>
                      {ops.webhook.WARNING > 0 && <Badge variant={webhookBadgeVariant('WARNING')}>{ops.webhook.WARNING} warning</Badge>}
                      {ops.webhook.CRITICAL > 0 && <Badge variant={webhookBadgeVariant('CRITICAL')}>{ops.webhook.CRITICAL} critical</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {accountRows.length === 0 ? (
                    <EmptyState icon={Smartphone} title="No connected accounts" description="Connect a WhatsApp account from the Accounts page to see operations here." />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Daily usage</TableHead>
                          <TableHead>Rate limit</TableHead>
                          <TableHead>Quality</TableHead>
                          <TableHead>Tier</TableHead>
                          <TableHead>Active campaigns</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {accountRows.map((row) => (
                          <TableRow key={row.accountId}>
                            <TableCell>{row.businessName || row.accountId}</TableCell>
                            <TableCell>
                              {row.sentToday} / {row.dailyLimit ?? '∞'}
                              {!row.withinLimit && <Badge variant="danger" className="ml-2">limit reached</Badge>}
                            </TableCell>
                            <TableCell>
                              {row.rate?.sentLastMinute ?? 0} / {row.rate?.effectiveLimitPerMinute ?? '—'}
                              {row.rate?.throttled && <Badge variant="warning" className="ml-2">throttled</Badge>}
                            </TableCell>
                            <TableCell>{row.quality?.qualityRating ?? '—'}</TableCell>
                            <TableCell>{row.quality?.messagingLimitTier ?? '—'}</TableCell>
                            <TableCell>{row.activeCampaigns}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {ops && ops.upcomingExpiry.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                      <Clock3 className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">Upcoming token expiry</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ops.upcomingExpiry.map((entry) => (
                    <div key={entry.accountId} className="flex items-center justify-between rounded-2xl border border-[var(--border)] px-4 py-3 text-sm">
                      <span className="text-[var(--text-primary)]">{entry.businessName || entry.accountId}</span>
                      <span className="text-[var(--text-muted)]">{entry.tokenExpiresAt ? new Date(entry.tokenExpiresAt).toLocaleString() : 'unknown'}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                    <Upload className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">Recent imports</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {data.recentImports.length === 0 ? (
                  <EmptyState icon={Upload} title="No imports yet" description="Import contacts via CSV or Excel from the Contacts page to see history here." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Imported</TableHead>
                        <TableHead>Duplicate</TableHead>
                        <TableHead>Invalid</TableHead>
                        <TableHead>Skipped</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentImports.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell>{batch.filename || '—'}</TableCell>
                          <TableCell>{batch.source}</TableCell>
                          <TableCell>{batch.importedCount}</TableCell>
                          <TableCell>{batch.duplicateCount}</TableCell>
                          <TableCell>{batch.invalidCount}</TableCell>
                          <TableCell>{batch.skippedCount}</TableCell>
                          <TableCell>{new Date(batch.createdAt).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {ops && ops.schedulers.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Scheduler registry</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scheduler</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last run</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Failures</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ops.schedulers.map((s) => (
                        <TableRow key={s.name}>
                          <TableCell>{s.name}</TableCell>
                          <TableCell>
                            <Badge variant={s.running ? (s.lastError ? 'warning' : 'success') : 'danger'}>{s.running ? (s.lastError ? 'warning' : 'running') : 'stopped'}</Badge>
                          </TableCell>
                          <TableCell>{s.lastTickAt ? new Date(s.lastTickAt).toLocaleTimeString() : 'never'}</TableCell>
                          <TableCell>{s.lastDurationMs != null ? `${s.lastDurationMs}ms` : '—'}</TableCell>
                          <TableCell>{s.totalFailures} / {s.totalRuns}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {!data.account && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card>
                <CardContent className="p-6 text-sm text-[var(--text-muted)]">
                  No WhatsApp account connected yet. <Link to="/whatsapp/accounts" className="text-blue-300 hover:text-blue-100">Connect one</Link> to get started.
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
