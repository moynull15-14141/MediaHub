import React, { useEffect, useState } from 'react';
import { ShieldOff, Plus, Trash2, Search, Upload, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { getApiBase } from '@/src/lib/api';

interface BlacklistEntry {
  id: string;
  phoneNumber: string;
  reason: 'BLOCKED' | 'UNSUBSCRIBED' | 'INVALID' | 'FAILED';
  note: string | null;
  createdAt: string;
}

const reasonVariant = (reason: BlacklistEntry['reason']) => (reason === 'BLOCKED' ? 'danger' : reason === 'INVALID' ? 'warning' : 'outline');

export function BlacklistTab() {
  const { token } = useAuth();
  const { push } = useToast();

  const [entries, setEntries] = useState<BlacklistEntry[] | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ phoneNumber: '', reason: 'BLOCKED' as BlacklistEntry['reason'], note: '' });
  const [importing, setImporting] = useState(false);

  const pageSize = 25;

  const load = async () => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (search) params.set('search', search);
    if (reason) params.set('reason', reason);
    try {
      const result = await whatsappFetch<{ entries: BlacklistEntry[]; total: number; totalPages: number }>(token, `/blacklist?${params.toString()}`);
      setEntries(result.entries);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      push({ title: 'Failed to load blacklist', description: err.message });
    }
  };

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, reason]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const allSelected = entries && entries.length > 0 && entries.every((e) => selected.has(e.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((entries || []).map((e) => e.id)));
  const toggleOne = (id: string) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await whatsappFetch(token, '/blacklist', { method: 'POST', body: JSON.stringify(form) });
      push({ title: 'Added to blacklist', description: form.phoneNumber });
      setAddOpen(false);
      setForm({ phoneNumber: '', reason: 'BLOCKED', note: '' });
      load();
    } catch (err: any) {
      push({ title: 'Failed to add', description: err.message });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await whatsappFetch(token, `/blacklist/${id}`, { method: 'DELETE' });
      load();
    } catch (err: any) {
      push({ title: 'Failed to delete', description: err.message });
    }
  };

  const handleBulkDelete = async () => {
    try {
      const result = await whatsappFetch<{ deletedCount: number }>(token, '/blacklist/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: Array.from(selected) }) });
      push({ title: 'Deleted', description: `${result.deletedCount} entr${result.deletedCount === 1 ? 'y' : 'ies'} removed.` });
      setSelected(new Set());
      load();
    } catch (err: any) {
      push({ title: 'Failed to bulk delete', description: err.message });
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${getApiBase()}/api/whatsapp/blacklist/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Import failed');
      push({ title: 'Import complete', description: `${body.imported} imported, ${body.skipped} skipped.` });
      load();
    } catch (err: any) {
      push({ title: 'Import failed', description: err.message });
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/whatsapp/blacklist/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blacklist.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      push({ title: 'Export failed', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--text-muted)]">{total} number{total === 1 ? '' : 's'} on your blacklist. These are never sent to.</p>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--panel-bg)]">
              <Upload className="h-4 w-4" /> {importing ? 'Importing…' : 'Import CSV'}
            </span>
            <input type="file" accept=".csv" className="hidden" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
          </label>
          <Button variant="outline" onClick={handleExport}><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
          <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add number</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search phone numbers…" className="pl-10" />
        </div>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-[180px]">
          <option value="">All reasons</option>
          <option value="BLOCKED">Blocked</option>
          <option value="UNSUBSCRIBED">Unsubscribed</option>
          <option value="INVALID">Invalid</option>
          <option value="FAILED">Failed</option>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--text-primary)]">{selected.size} selected</span>
          <Button variant="outline" size="sm" className="text-rose-300 hover:bg-rose-500/10" onClick={handleBulkDelete}><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
        </div>
      )}

      {entries === undefined ? (
        <Skeleton className="h-72 w-full" />
      ) : entries.length === 0 ? (
        <EmptyState icon={ShieldOff} title="No blocked numbers" description="Add numbers manually or import a CSV to keep them out of every campaign." action={<Button onClick={() => setAddOpen(true)}>Add number</Button>} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={!!allSelected} onChange={toggleAll} /></TableHead>
                <TableHead>Phone number</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell><Checkbox checked={selected.has(entry.id)} onChange={() => toggleOne(entry.id)} /></TableCell>
                  <TableCell className="font-medium">{entry.phoneNumber}</TableCell>
                  <TableCell><Badge variant={reasonVariant(entry.reason)}>{entry.reason}</Badge></TableCell>
                  <TableCell className="text-[var(--text-secondary)]">{entry.note || '—'}</TableCell>
                  <TableCell>{new Date(entry.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)} aria-label="Remove"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-secondary)]">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add to blacklist</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Phone number
              <Input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+8801712345678" required />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Reason
              <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as BlacklistEntry['reason'] })}>
                <option value="BLOCKED">Blocked</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
                <option value="INVALID">Invalid</option>
                <option value="FAILED">Failed</option>
              </Select>
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Note (optional)
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
