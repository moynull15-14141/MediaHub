import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Ban, Clock3, Gauge, Hourglass } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { getApiBase } from '@/src/lib/api';

interface ProgressData {
  sendStatus: string;
  total: number;
  counts: Record<string, number>;
  delivery: Record<string, number>;
  percentage: number;
  remaining: number;
  elapsedMs: number | null;
  etaSeconds: number | null;
  messagesPerMinute: number | null;
}

interface SendLog {
  id: string;
  attempt: number;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface CampaignProgressDialogProps {
  open: boolean;
  campaignId: string | null;
  campaignName?: string;
  onClose: () => void;
  onChanged: () => void;
}

const formatDuration = (ms: number | null): string => {
  if (ms === null) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const sendStatusVariant = (status: string) => {
  switch (status) {
    case 'SENDING': return 'warning';
    case 'COMPLETED': return 'success';
    case 'PAUSED': return 'outline';
    case 'CANCELLED': return 'outline';
    case 'FAILED': return 'danger';
    case 'SCHEDULED': return 'default';
    default: return 'outline';
  }
};

export function CampaignProgressDialog({ open, campaignId, campaignName, onClose, onChanged }: CampaignProgressDialogProps) {
  const { token } = useAuth();
  const { push } = useToast();

  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadLogs = async () => {
    if (!campaignId) return;
    setLogsLoading(true);
    try {
      const result = await whatsappFetch<{ logs: SendLog[] }>(token, `/campaigns/${campaignId}/logs?pageSize=20`);
      setLogs(result.logs);
    } catch {
      // non-critical, leave previous logs in place
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !campaignId) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setProgress(null);
      return;
    }

    loadLogs();

    const url = `${getApiBase()}/api/whatsapp/campaigns/${campaignId}/events?token=${encodeURIComponent(token || '')}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        setProgress(JSON.parse(event.data));
      } catch {
        // ignore malformed frame
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaignId]);

  const runAction = async (path: string, label: string) => {
    if (!campaignId) return;
    setActionBusy(true);
    try {
      await whatsappFetch(token, `/campaigns/${campaignId}/${path}`, { method: 'POST' });
      push({ title: label });
      onChanged();
      loadLogs();
    } catch (err: any) {
      push({ title: `Failed to ${label.toLowerCase()}`, description: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const counts = progress?.counts;
  const queued = (counts?.PENDING ?? 0) + (counts?.WAITING ?? 0);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogContent className="max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{campaignName || 'Campaign progress'}</DialogTitle>
          {progress && <Badge variant={sendStatusVariant(progress.sendStatus) as any}>{progress.sendStatus}</Badge>}
        </DialogHeader>

        {!progress ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="space-y-5">
            <div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--panel-bg)]">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${progress.percentage}%` }} />
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{progress.percentage}% complete · {progress.remaining} remaining of {progress.total}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {[
                { label: 'Queued', value: queued },
                { label: 'Sending', value: counts?.SENDING ?? 0 },
                { label: 'Sent', value: counts?.SENT ?? 0 },
                { label: 'Delivered', value: progress.delivery?.DELIVERED ?? 0 },
                { label: 'Read', value: progress.delivery?.READ ?? 0 },
                { label: 'Retrying', value: counts?.RETRY ?? 0 },
                { label: 'Failed', value: counts?.FAILED ?? 0 },
                { label: 'Cancelled', value: counts?.CANCELLED ?? 0 },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-[var(--border)] px-3 py-2 text-center">
                  <p className="text-lg font-semibold text-[var(--text-primary)]">{stat.value}</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs text-[var(--text-secondary)]">
              <div className="flex flex-col items-center gap-1"><Clock3 className="h-4 w-4" /> Elapsed<br /><span className="text-[var(--text-primary)]">{formatDuration(progress.elapsedMs)}</span></div>
              <div className="flex flex-col items-center gap-1"><Gauge className="h-4 w-4" /> Speed<br /><span className="text-[var(--text-primary)]">{progress.messagesPerMinute ?? '—'}/min</span></div>
              <div className="flex flex-col items-center gap-1"><Hourglass className="h-4 w-4" /> ETA<br /><span className="text-[var(--text-primary)]">{progress.etaSeconds ? formatDuration(progress.etaSeconds * 1000) : '—'}</span></div>
            </div>

            <div className="flex flex-wrap gap-2">
              {progress.sendStatus === 'SENDING' && (
                <Button type="button" variant="outline" size="sm" disabled={actionBusy} onClick={() => runAction('pause', 'Campaign paused')}>
                  <Pause className="mr-2 h-4 w-4" /> Pause
                </Button>
              )}
              {progress.sendStatus === 'PAUSED' && (
                <Button type="button" variant="outline" size="sm" disabled={actionBusy} onClick={() => runAction('resume', 'Campaign resumed')}>
                  <Play className="mr-2 h-4 w-4" /> Resume
                </Button>
              )}
              {['SENDING', 'PAUSED', 'SCHEDULED', 'QUEUED'].includes(progress.sendStatus) && (
                <Button type="button" variant="outline" size="sm" className="text-rose-300 hover:bg-rose-500/10" disabled={actionBusy} onClick={() => runAction('queue/cancel', 'Campaign cancelled')}>
                  <Ban className="mr-2 h-4 w-4" /> Cancel
                </Button>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">Recent attempts</p>
              {logsLoading && logs.length === 0 ? (
                <Skeleton className="h-32 w-full" />
              ) : logs.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">No send attempts logged yet.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-2xl border border-[var(--border)]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Attempt</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs">{new Date(log.createdAt).toLocaleTimeString()}</TableCell>
                          <TableCell className="text-xs">{log.attempt}</TableCell>
                          <TableCell><Badge variant={log.status === 'SENT' ? 'success' : log.status === 'RETRY' ? 'warning' : 'danger'}>{log.status}</Badge></TableCell>
                          <TableCell className="text-xs">{log.durationMs ? `${log.durationMs}ms` : '—'}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-xs text-[var(--text-secondary)]" title={log.errorMessage || ''}>{log.errorMessage || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
