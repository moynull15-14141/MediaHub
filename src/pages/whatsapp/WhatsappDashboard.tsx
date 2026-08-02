import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Smartphone, Users, FolderKanban, Tag, Upload } from 'lucide-react';
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

export default function WhatsappDashboard() {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<DashboardData | undefined>(undefined);

  useEffect(() => {
    whatsappFetch<DashboardData>(token, '/dashboard')
      .then(setData)
      .catch((err) => push({ title: 'Failed to load dashboard', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = data
    ? [
        { label: 'Total contacts', value: data.totalContacts, icon: Users },
        { label: 'Total groups', value: data.totalGroups, icon: FolderKanban },
        { label: 'Total labels', value: data.totalLabels, icon: Tag },
      ]
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
