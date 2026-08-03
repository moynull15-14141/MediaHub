import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Users, Plus, Pencil, Trash2, Search, Upload, ChevronLeft, ChevronRight, FolderPlus, FileUp, X } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
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

interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  countryCode: string;
  email: string | null;
  company: string | null;
  city: string | null;
  country: string | null;
  customFields: Record<string, string>;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  labels?: { id: string; name: string; color: string }[];
}

interface WhatsappGroup { id: string; name: string; }
interface WhatsappLabel { id: string; name: string; color: string; }

interface ImportRow {
  rowNumber: number;
  name: string;
  phoneNumber: string;
  countryCode: string;
  email?: string;
  company?: string;
  notes?: string;
  status: 'valid' | 'duplicate' | 'invalid' | 'skipped';
  reason?: string;
}

const EMPTY_FORM = { name: '', phoneNumber: '', countryCode: '', email: '', company: '', city: '', country: '', notes: '', status: 'ACTIVE' as Contact['status'] };

interface CustomFieldRow { key: string; value: string; }

const statusVariant = (status: Contact['status']) => (status === 'ACTIVE' ? 'success' : status === 'BLOCKED' ? 'danger' : 'outline');

export default function WhatsappContacts() {
  const { token } = useAuth();
  const { push } = useToast();
  const [searchParams] = useSearchParams();

  const [contacts, setContacts] = useState<Contact[] | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [groupId, setGroupId] = useState('');
  const [labelId, setLabelId] = useState(searchParams.get('labelId') || '');

  const [groups, setGroups] = useState<WhatsappGroup[]>([]);
  const [labels, setLabels] = useState<WhatsappLabel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [customFieldRows, setCustomFieldRows] = useState<CustomFieldRow[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [addToGroupOpen, setAddToGroupOpen] = useState(false);
  const [addToGroupId, setAddToGroupId] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<{ rows: ImportRow[]; summary: { total: number; valid: number; duplicate: number; invalid: number; skipped: number }; source: 'CSV' | 'XLSX'; filename: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const pageSize = 25;

  const loadContacts = async () => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (groupId) params.set('groupId', groupId);
    if (labelId) params.set('labelId', labelId);
    try {
      const result = await whatsappFetch<{ contacts: Contact[]; total: number; totalPages: number }>(token, `/contacts?${params.toString()}`);
      setContacts(result.contacts);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      push({ title: 'Failed to load contacts', description: err.message });
    }
  };

  useEffect(() => {
    whatsappFetch<WhatsappGroup[]>(token, '/groups').then(setGroups).catch(() => {});
    whatsappFetch<WhatsappLabel[]>(token, '/labels').then(setLabels).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); loadContacts(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, groupId, labelId]);

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const allSelected = contacts && contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  const toggleAll = () => {
    if (!contacts) return;
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(contacts.map((c) => c.id));
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCustomFieldRows([]);
    setSelectedLabelIds(new Set());
    setFormOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditing(contact);
    setForm({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      countryCode: contact.countryCode,
      email: contact.email || '',
      company: contact.company || '',
      city: contact.city || '',
      country: contact.country || '',
      notes: contact.notes || '',
      status: contact.status,
    });
    setCustomFieldRows(Object.entries(contact.customFields || {}).map(([key, value]) => ({ key, value })));
    setSelectedLabelIds(new Set((contact.labels || []).map((l) => l.id)));
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customFields: Record<string, string> = {};
    for (const row of customFieldRows) {
      if (row.key.trim()) customFields[row.key.trim()] = row.value;
    }
    const body = {
      ...form,
      email: form.email || undefined,
      company: form.company || undefined,
      city: form.city || undefined,
      country: form.country || undefined,
      notes: form.notes || undefined,
      customFields,
    };
    try {
      let contact: Contact;
      if (editing) {
        contact = await whatsappFetch<Contact>(token, `/contacts/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        contact = await whatsappFetch<Contact>(token, '/contacts', { method: 'POST', body: JSON.stringify(body) });
      }
      await whatsappFetch(token, `/contacts/${contact.id}/labels`, { method: 'POST', body: JSON.stringify({ labelIds: Array.from(selectedLabelIds) }) });
      push({ title: editing ? 'Contact updated' : 'Contact added', description: form.name });
      setFormOpen(false);
      loadContacts();
    } catch (err: any) {
      push({ title: 'Failed to save contact', description: err.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await whatsappFetch(token, `/contacts/${deleteTarget.id}`, { method: 'DELETE' });
      push({ title: 'Contact deleted', description: deleteTarget.name });
      setDeleteTarget(null);
      loadContacts();
    } catch (err: any) {
      push({ title: 'Failed to delete contact', description: err.message });
    }
  };

  const handleBulkDelete = async () => {
    try {
      const result = await whatsappFetch<{ deletedCount: number }>(token, '/contacts/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: Array.from(selected) }) });
      push({ title: 'Contacts deleted', description: `${result.deletedCount} contact(s) removed.` });
      setSelected(new Set());
      setBulkDeleteOpen(false);
      loadContacts();
    } catch (err: any) {
      push({ title: 'Failed to delete contacts', description: err.message });
    }
  };

  const handleAddToGroup = async () => {
    if (!addToGroupId) return;
    try {
      await whatsappFetch(token, `/groups/${addToGroupId}/contacts`, { method: 'POST', body: JSON.stringify({ contactIds: Array.from(selected) }) });
      push({ title: 'Added to group', description: `${selected.size} contact(s) assigned.` });
      setAddToGroupOpen(false);
      setAddToGroupId('');
      setSelected(new Set());
    } catch (err: any) {
      push({ title: 'Failed to assign to group', description: err.message });
    }
  };

  const handleFileSelected = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${getApiBase()}/api/whatsapp/contacts/import/preview`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Preview failed');
      setImportPreview(body);
    } catch (err: any) {
      push({ title: 'Import preview failed', description: err.message });
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await whatsappFetch<{ importedCount: number; duplicateCount: number; invalidCount: number; skippedCount: number }>(token, '/contacts/import/commit', {
        method: 'POST',
        body: JSON.stringify({ rows: importPreview.rows, filename: importPreview.filename, source: importPreview.source }),
      });
      push({ title: 'Import complete', description: `Imported ${result.importedCount}, duplicate ${result.duplicateCount}, invalid ${result.invalidCount}, skipped ${result.skippedCount}.` });
      setImportOpen(false);
      setImportPreview(null);
      loadContacts();
    } catch (err: any) {
      push({ title: 'Import failed', description: err.message });
    } finally {
      setImporting(false);
    }
  };

  const rowStatusVariant = (s: ImportRow['status']) => (s === 'valid' ? 'success' : s === 'duplicate' ? 'warning' : s === 'invalid' ? 'danger' : 'outline');

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Contacts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{total} contact{total === 1 ? '' : 's'} in your database.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => { setImportOpen(true); setImportPreview(null); }}><Upload className="mr-2 h-4 w-4" /> Import</Button>
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add contact</Button>
        </div>
      </motion.div>

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email…" className="pl-10" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[160px]">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="BLOCKED">Blocked</option>
        </Select>
        <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="max-w-[180px]">
          <option value="">All groups</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <Select value={labelId} onChange={(e) => setLabelId(e.target.value)} className="max-w-[180px]">
          <option value="">All labels</option>
          {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--text-primary)]">{selected.size} selected</span>
          <Button variant="outline" size="sm" onClick={() => setAddToGroupOpen(true)}><FolderPlus className="mr-2 h-4 w-4" /> Add to group</Button>
          <Button variant="outline" size="sm" className="text-rose-300 hover:bg-rose-500/10" onClick={() => setBulkDeleteOpen(true)}><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
        </div>
      )}

      {contacts === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : contacts.length === 0 ? (
        <EmptyState icon={Users} title="No contacts found" description="Add a contact manually or import a CSV/Excel file to get started." action={<Button onClick={openCreate}>Add contact</Button>} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={!!allSelected} onChange={toggleAll} /></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Labels</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell><Checkbox checked={selected.has(contact.id)} onChange={() => toggleOne(contact.id)} /></TableCell>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell>{contact.phoneNumber}</TableCell>
                  <TableCell>{contact.email || '—'}</TableCell>
                  <TableCell>{contact.company || '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(contact.labels || []).map((l) => (
                        <Badge key={l.id} variant="outline" style={{ borderColor: l.color, color: l.color }}>{l.name}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={statusVariant(contact.status)}>{contact.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(contact)} aria-label="Edit contact"><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(contact)} aria-label="Delete contact"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                    </div>
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

      {/* Add / edit contact */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit contact' : 'Add contact'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Name
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Status
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Contact['status'] })}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="BLOCKED">Blocked</option>
                </Select>
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Phone number
                <Input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="e.g. 01712345678" required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Country code
                <Input value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value.toUpperCase() })} placeholder="e.g. BD" maxLength={2} required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Email (optional)
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Company (optional)
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                City (optional)
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Country (optional)
                <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </label>
            </div>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Notes (optional)
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500"
              />
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--text-secondary)]">Custom fields <span className="text-[var(--text-muted)]">(used as {'{{variables}}'} in messages)</span></p>
                <Button type="button" variant="outline" size="sm" onClick={() => setCustomFieldRows((rows) => [...rows, { key: '', value: '' }])}>Add field</Button>
              </div>
              {customFieldRows.length > 0 && (
                <div className="space-y-2">
                  {customFieldRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={row.key}
                        onChange={(e) => setCustomFieldRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))}
                        placeholder="Field name, e.g. Balance"
                        className="flex-1"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => setCustomFieldRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))}
                        placeholder="Value, e.g. 5000"
                        className="flex-1"
                      />
                      <button type="button" onClick={() => setCustomFieldRows((rows) => rows.filter((_, idx) => idx !== i))} aria-label="Remove field" className="text-[var(--text-secondary)] hover:text-rose-300">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {labels.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-[var(--text-secondary)]">Labels</p>
                <div className="flex flex-wrap gap-2">
                  {labels.map((l) => {
                    const active = selectedLabelIds.has(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setSelectedLabelIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
                          return next;
                        })}
                        className={active ? 'rounded-full px-3 py-1 text-xs font-semibold' : 'rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]'}
                        style={active ? { backgroundColor: `${l.color}22`, color: l.color, border: `1px solid ${l.color}` } : undefined}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit">{editing ? 'Save' : 'Add contact'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete single */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete */}
      <Dialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {selected.size} contact(s)?</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleBulkDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to group */}
      <Dialog open={addToGroupOpen} onClose={() => setAddToGroupOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {selected.size} contact(s) to group</DialogTitle></DialogHeader>
          <Select value={addToGroupId} onChange={(e) => setAddToGroupId(e.target.value)}>
            <option value="">Select a group…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToGroupOpen(false)}>Cancel</Button>
            <Button onClick={handleAddToGroup} disabled={!addToGroupId}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={importOpen} onClose={() => setImportOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Import contacts</DialogTitle></DialogHeader>
          {!importPreview ? (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--border)] px-6 py-12 text-center hover:border-blue-500">
                <FileUp className="h-8 w-8 text-[var(--text-secondary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">Click to select a .csv or .xlsx file</span>
                <span className="text-xs text-[var(--text-muted)]">Expected columns: Name, Phone, Email, Company, Notes — any extra columns automatically become custom fields / message variables. Country Code is only required if your phone numbers don't already start with "+" (e.g. "+8801XXXXXXXXX" needs no separate Country Code column).</span>
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); }} />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                <div className="rounded-2xl bg-emerald-500/10 px-3 py-3"><p className="text-lg font-semibold text-emerald-300">{importPreview.summary.valid}</p><p className="text-xs text-emerald-200/80">Will import</p></div>
                <div className="rounded-2xl bg-amber-500/10 px-3 py-3"><p className="text-lg font-semibold text-amber-300">{importPreview.summary.duplicate}</p><p className="text-xs text-amber-200/80">Duplicate</p></div>
                <div className="rounded-2xl bg-rose-500/10 px-3 py-3"><p className="text-lg font-semibold text-rose-300">{importPreview.summary.invalid}</p><p className="text-xs text-rose-200/80">Invalid</p></div>
                <div className="rounded-2xl bg-[var(--panel-bg)] px-3 py-3"><p className="text-lg font-semibold text-[var(--text-primary)]">{importPreview.summary.skipped}</p><p className="text-xs text-[var(--text-secondary)]">Skipped</p></div>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.rows.slice(0, 200).map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>{row.name || '—'}</TableCell>
                        <TableCell>{row.phoneNumber || '—'}</TableCell>
                        <TableCell><Badge variant={rowStatusVariant(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-xs text-[var(--text-secondary)]">{row.reason || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setImportPreview(null)}>Choose another file</Button>
                <Button onClick={handleCommitImport} disabled={importing || importPreview.summary.valid === 0}>
                  {importing ? 'Importing…' : `Import ${importPreview.summary.valid} contact(s)`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
