import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { AnalyticsFiltersBar, AnalyticsFilters, filtersToQuery } from './AnalyticsFiltersBar';
import { ExportMenu } from './ExportMenu';
import { DonutChart } from './charts/DonutChart';
import { LineChart } from './charts/LineChart';
import { formatDuration } from './formatters';

interface CampaignRow {
  id: string; name: string; sendStatus: string; recipients: number; delivered: number; read: number;
  failed: number; skipped: number; retryCount: number; startTime: string | null; finishTime: string | null;
  durationMs: number | null; avgSendSpeedPerMinute: number | null;
}

interface CampaignDetail extends CampaignRow {
  pending: number; retrying: number; avgQueueTimeMs: number | null;
  statusBreakdown: { status: string; count: number }[];
  timeline: { sent: { bucket: string; count: number }[]; delivered: { bucket: string; count: number }[]; read: { bucket: string; count: number }[]; failed: { bucket: string; count: number }[] };
}

const STATUS_COLORS: Record<string, string> = {
  SENT: '#3b82f6', PENDING: '#94a3b8', WAITING: '#94a3b8', SENDING: '#f59e0b', RETRY: '#f59e0b', FAILED: '#ef4444', CANCELLED: '#64748b', SKIPPED: '#a855f7',
};

const statusVariant = (status: string) =>
  status === 'COMPLETED' ? 'success' : status === 'FAILED' || status === 'CANCELLED' ? 'danger' : status === 'SENDING' ? 'default' : 'outline';

const bucketLabel = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' });

export function CampaignAnalyticsTab({ filters, onFiltersChange }: { filters: AnalyticsFilters; onFiltersChange: (f: AnalyticsFilters) => void }) {
  const { token } = useAuth();
  const { push } = useToast();
  const [rows, setRows] = useState<CampaignRow[] | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const pageSize = 20;

  const load = () => {
    const query = filtersToQuery(filters);
    whatsappFetch<{ campaigns: CampaignRow[]; total: number; totalPages: number }>(
      token,
      `/analytics/campaigns?page=${page}&pageSize=${pageSize}${query ? `&${query}` : ''}`,
    )
      .then((res) => {
        setRows(res.campaigns);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err) => push({ title: 'Failed to load campaign analytics', description: err.message }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, JSON.stringify(filters)]);

  const openDetail = async (id: string) => {
    try {
      const data = await whatsappFetch<CampaignDetail>(token, `/analytics/campaigns/${id}`);
      setDetail(data);
    } catch (err: any) {
      push({ title: 'Failed to load campaign detail', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnalyticsFiltersBar filters={filters} onChange={(f) => { setPage(1); onFiltersChange(f); }} showStatus showGroupLabel showSearch />
        <ExportMenu dataset="CAMPAIGNS" filters={filters} page={page} pageSize={pageSize} supportsPageScope />
      </div>

      {rows === undefined ? (
        <Skeleton className="h-72 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="No campaigns match these filters" description="Adjust the filters above or create a campaign to see analytics here." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Read</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>Skipped</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Avg speed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => openDetail(c.id)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant={statusVariant(c.sendStatus) as any}>{c.sendStatus.replace('_', ' ')}</Badge></TableCell>
                  <TableCell>{c.recipients}</TableCell>
                  <TableCell>{c.delivered}</TableCell>
                  <TableCell>{c.read}</TableCell>
                  <TableCell>{c.failed}</TableCell>
                  <TableCell>{c.skipped}</TableCell>
                  <TableCell>{c.retryCount}</TableCell>
                  <TableCell>{formatDuration(c.durationMs)}</TableCell>
                  <TableCell>{c.avgSendSpeedPerMinute ?? '—'}{c.avgSendSpeedPerMinute ? '/min' : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-secondary)]">{total} campaign{total === 1 ? '' : 's'} · Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!detail} onClose={() => setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.name}</DialogTitle></DialogHeader>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Recipients', detail.recipients], ['Delivered', detail.delivered], ['Read', detail.read], ['Failed', detail.failed],
                    ['Skipped', detail.skipped], ['Pending', detail.pending], ['Retrying', detail.retrying], ['Retries', detail.retryCount],
                  ].map(([label, value]) => (
                    <Card key={label as string}><CardContent className="p-4"><p className="text-xs text-[var(--text-secondary)]">{label}</p><p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</p></CardContent></Card>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Card><CardContent className="p-4"><p className="text-xs text-[var(--text-secondary)]">Duration</p><p className="mt-1 font-semibold text-[var(--text-primary)]">{formatDuration(detail.durationMs)}</p></CardContent></Card>
                  <Card><CardContent className="p-4"><p className="text-xs text-[var(--text-secondary)]">Avg queue time</p><p className="mt-1 font-semibold text-[var(--text-primary)]">{formatDuration(detail.avgQueueTimeMs)}</p></CardContent></Card>
                  <Card><CardContent className="p-4"><p className="text-xs text-[var(--text-secondary)]">Avg send speed</p><p className="mt-1 font-semibold text-[var(--text-primary)]">{detail.avgSendSpeedPerMinute ?? '—'}/min</p></CardContent></Card>
                </div>

                <div>
                  <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">Status breakdown</p>
                  <DonutChart data={detail.statusBreakdown.map((s) => ({ label: s.status, value: s.count, color: STATUS_COLORS[s.status] || '#94a3b8' }))} />
                </div>

                <div>
                  <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">Timeline</p>
                  <LineChart
                    series={[
                      { name: 'Sent', color: '#3b82f6', points: detail.timeline.sent.map((p) => ({ label: bucketLabel(p.bucket), value: p.count })) },
                      { name: 'Delivered', color: '#10b981', points: detail.timeline.delivered.map((p) => ({ label: bucketLabel(p.bucket), value: p.count })) },
                    ]}
                  />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
