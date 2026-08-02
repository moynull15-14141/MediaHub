import React, { useEffect, useState } from 'react';
import { FileClock, Plus, Trash2, Download, CalendarClock, PlayCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { formatBytes } from './formatters';

const DATASETS = ['OVERVIEW', 'CAMPAIGNS', 'CONTACTS', 'TEMPLATES', 'QUEUE', 'API', 'WEBHOOK'];
const FORMATS = ['CSV', 'XLSX', 'PDF'];
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];

interface ScheduledReport {
  id: string; name: string; frequency: string; dataset: string; format: string; enabled: boolean; lastRunAt: string | null; nextRunAt: string;
}
interface HistoryEntry {
  id: string; name: string; dataset: string; format: string; fileSizeBytes: number; generatedBy: string; createdAt: string;
}

export function ReportsTab() {
  const { token } = useAuth();
  const { push } = useToast();

  const [scheduled, setScheduled] = useState<ScheduledReport[] | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[] | undefined>(undefined);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ name: '', frequency: 'WEEKLY', dataset: 'OVERVIEW', format: 'PDF' });
  const [saving, setSaving] = useState(false);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({ name: '', dataset: 'OVERVIEW', format: 'PDF' });
  const [generating, setGenerating] = useState(false);

  const loadScheduled = () => whatsappFetch<ScheduledReport[]>(token, '/analytics/scheduled-reports').then(setScheduled).catch(() => {});
  const loadHistory = () =>
    whatsappFetch<{ entries: HistoryEntry[]; total: number; totalPages: number }>(token, `/analytics/reports/history?page=${historyPage}&pageSize=15`)
      .then((r) => { setHistory(r.entries); setHistoryTotal(r.total); setHistoryTotalPages(r.totalPages); })
      .catch(() => {});

  useEffect(() => { loadScheduled(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadHistory(); }, [historyPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await whatsappFetch(token, '/analytics/scheduled-reports', { method: 'POST', body: JSON.stringify(scheduleForm) });
      push({ title: 'Scheduled report created' });
      setScheduleOpen(false);
      setScheduleForm({ name: '', frequency: 'WEEKLY', dataset: 'OVERVIEW', format: 'PDF' });
      loadScheduled();
    } catch (err: any) {
      push({ title: 'Failed to create schedule', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (report: ScheduledReport) => {
    try {
      await whatsappFetch(token, `/analytics/scheduled-reports/${report.id}`, { method: 'PUT', body: JSON.stringify({ ...report, enabled: !report.enabled }) });
      loadScheduled();
    } catch (err: any) {
      push({ title: 'Failed to update schedule', description: err.message });
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      await whatsappFetch(token, `/analytics/scheduled-reports/${id}`, { method: 'DELETE' });
      loadScheduled();
    } catch (err: any) {
      push({ title: 'Failed to delete schedule', description: err.message });
    }
  };

  const handleGenerateNow = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      await whatsappFetch(token, '/analytics/reports/generate', {
        method: 'POST',
        body: JSON.stringify({ name: generateForm.name || `${generateForm.dataset} Report`, dataset: generateForm.dataset, format: generateForm.format, filters: {} }),
      });
      push({ title: 'Report generated' });
      setGenerateOpen(false);
      setGenerateForm({ name: '', dataset: 'OVERVIEW', format: 'PDF' });
      setHistoryPage(1);
      loadHistory();
    } catch (err: any) {
      push({ title: 'Failed to generate report', description: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (id: string) => {
    try {
      const { url } = await whatsappFetch<{ url: string }>(token, `/analytics/reports/history/${id}/download`);
      window.open(url, '_blank', 'noopener');
    } catch (err: any) {
      push({ title: 'Failed to download report', description: err.message });
    }
  };

  const handleDeleteHistory = async (id: string) => {
    try {
      await whatsappFetch(token, `/analytics/reports/history/${id}`, { method: 'DELETE' });
      loadHistory();
    } catch (err: any) {
      push({ title: 'Failed to delete report', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" /> Scheduled reports</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setGenerateOpen(true)}><PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Generate now</Button>
              <Button size="sm" onClick={() => setScheduleOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" /> New schedule</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {scheduled === undefined ? (
            <Skeleton className="h-32 w-full" />
          ) : scheduled.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No scheduled reports" description="Create a daily, weekly, or monthly report that generates automatically." action={<Button size="sm" onClick={() => setScheduleOpen(true)}>New schedule</Button>} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Frequency</TableHead><TableHead>Dataset</TableHead><TableHead>Format</TableHead><TableHead>Next run</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {scheduled.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.frequency}</TableCell>
                    <TableCell><Badge variant="outline">{r.dataset}</Badge></TableCell>
                    <TableCell>{r.format}</TableCell>
                    <TableCell>{new Date(r.nextRunAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <button type="button" onClick={() => toggleEnabled(r)}>
                        <Badge variant={r.enabled ? 'success' : 'outline'}>{r.enabled ? 'Enabled' : 'Disabled'}</Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteSchedule(r.id)} aria-label="Delete schedule"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4"><CardTitle className="flex items-center gap-2 text-base"><FileClock className="h-4 w-4" /> Report history</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {history === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : history.length === 0 ? (
            <EmptyState icon={FileClock} title="No reports generated yet" description="Generate a report now or set up a schedule above." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Name</TableHead><TableHead>Dataset</TableHead><TableHead>Format</TableHead><TableHead>Size</TableHead><TableHead>Generated by</TableHead><TableHead>Generated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell><Badge variant="outline">{h.dataset}</Badge></TableCell>
                      <TableCell>{h.format}</TableCell>
                      <TableCell>{formatBytes(h.fileSizeBytes)}</TableCell>
                      <TableCell>{h.generatedBy}</TableCell>
                      <TableCell>{new Date(h.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleDownload(h.id)} aria-label="Download"><Download className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteHistory(h.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--text-secondary)]">{historyTotal} report{historyTotal === 1 ? '' : 's'} · Page {historyPage} of {historyTotalPages}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={scheduleOpen} onClose={() => setScheduleOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>New scheduled report</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateSchedule} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Name
              <Input value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} placeholder="Weekly overview" required />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Frequency
              <Select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}>
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Dataset
              <Select value={scheduleForm.dataset} onChange={(e) => setScheduleForm({ ...scheduleForm, dataset: e.target.value })}>
                {DATASETS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Format
              <Select value={scheduleForm.format} onChange={(e) => setScheduleForm({ ...scheduleForm, format: e.target.value })}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create schedule'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={generateOpen} onClose={() => setGenerateOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate report now</DialogTitle></DialogHeader>
          <form onSubmit={handleGenerateNow} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Name (optional)
              <Input value={generateForm.name} onChange={(e) => setGenerateForm({ ...generateForm, name: e.target.value })} placeholder="Auto-named if left blank" />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Dataset
              <Select value={generateForm.dataset} onChange={(e) => setGenerateForm({ ...generateForm, dataset: e.target.value })}>
                {DATASETS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Format
              <Select value={generateForm.format} onChange={(e) => setGenerateForm({ ...generateForm, format: e.target.value })}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={generating}>{generating ? 'Generating…' : 'Generate'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
