import { useEffect, useState } from 'react';
import { Users, UserCheck, ShieldOff, AlertCircle, UserPlus, UserMinus, Tag, FolderKanban, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { AnalyticsFiltersBar, AnalyticsFilters, filtersToQuery } from './AnalyticsFiltersBar';
import { ExportMenu } from './ExportMenu';
import { LineChart } from './charts/LineChart';
import { BarChart } from './charts/BarChart';

interface ContactAnalytics {
  totalContacts: number; activeContacts: number; inactiveContacts: number;
  blockedContacts: number; invalidContacts: number; subscribedContacts: number; unsubscribedContacts: number;
  topLabels: { id: string; name: string; color: string; contactCount: number }[];
  topGroups: { id: string; name: string; contactCount: number }[];
  growth: { date: string; count: number }[];
  importHistory: { id: string; filename: string | null; source: string; totalRows: number; importedCount: number; duplicateCount: number; invalidCount: number; skippedCount: number; createdAt: string }[];
}

const StatCard = ({ icon: Icon, label, value }: { icon: any; label: string; value: number }) => (
  <Card>
    <CardContent className="flex items-center justify-between p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
      </div>
      <Icon className="h-7 w-7 text-[var(--text-secondary)]" />
    </CardContent>
  </Card>
);

export function ContactAnalyticsTab({ filters, onFiltersChange }: { filters: AnalyticsFilters; onFiltersChange: (f: AnalyticsFilters) => void }) {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<ContactAnalytics | undefined>(undefined);

  useEffect(() => {
    const query = filtersToQuery(filters);
    whatsappFetch<ContactAnalytics>(token, `/analytics/contacts${query ? `?${query}` : ''}`)
      .then(setData)
      .catch((err) => push({ title: 'Failed to load contact analytics', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnalyticsFiltersBar filters={filters} onChange={onFiltersChange} />
        <ExportMenu dataset="CONTACTS" filters={filters} />
      </div>

      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <StatCard icon={Users} label="Total" value={data.totalContacts} />
            <StatCard icon={UserCheck} label="Active" value={data.activeContacts} />
            <StatCard icon={Users} label="Inactive" value={data.inactiveContacts} />
            <StatCard icon={ShieldOff} label="Blocked" value={data.blockedContacts} />
            <StatCard icon={AlertCircle} label="Invalid" value={data.invalidContacts} />
            <StatCard icon={UserPlus} label="Subscribed" value={data.subscribedContacts} />
            <StatCard icon={UserMinus} label="Unsubscribed" value={data.unsubscribedContacts} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Tag className="h-4 w-4" /> Top labels</CardTitle></CardHeader>
              <CardContent>
                <BarChart data={data.topLabels.map((l) => ({ label: l.name, value: l.contactCount, color: l.color }))} emptyLabel="No labels yet" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FolderKanban className="h-4 w-4" /> Top groups</CardTitle></CardHeader>
              <CardContent>
                <BarChart data={data.topGroups.map((g) => ({ label: g.name, value: g.contactCount }))} emptyLabel="No groups yet" defaultColor="#8b5cf6" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Contact growth</CardTitle></CardHeader>
            <CardContent>
              <LineChart series={[{ name: 'New contacts', color: '#3b82f6', points: data.growth.map((g) => ({ label: g.date, value: g.count })) }]} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> Import history</CardTitle></CardHeader>
            <CardContent>
              {data.importHistory.length === 0 ? (
                <EmptyState icon={Upload} title="No imports yet" description="Import contacts via CSV or Excel to see history here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead><TableHead>Source</TableHead><TableHead>Imported</TableHead>
                      <TableHead>Duplicate</TableHead><TableHead>Invalid</TableHead><TableHead>Skipped</TableHead><TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.importHistory.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{b.filename || '—'}</TableCell>
                        <TableCell>{b.source}</TableCell>
                        <TableCell>{b.importedCount}</TableCell>
                        <TableCell>{b.duplicateCount}</TableCell>
                        <TableCell>{b.invalidCount}</TableCell>
                        <TableCell>{b.skippedCount}</TableCell>
                        <TableCell>{new Date(b.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
