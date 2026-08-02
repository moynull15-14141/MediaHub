import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Tag, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface WhatsappLabel {
  id: string;
  name: string;
  color: string;
  contactCount: number;
  createdAt: string;
}

const PRESET_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

export default function WhatsappLabels() {
  const { token } = useAuth();
  const { push } = useToast();
  const [labels, setLabels] = useState<WhatsappLabel[] | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WhatsappLabel | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [deleteTarget, setDeleteTarget] = useState<WhatsappLabel | null>(null);

  const load = async (q?: string) => {
    try {
      const result = await whatsappFetch<WhatsappLabel[]>(token, `/labels${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      setLabels(result);
    } catch (err: any) {
      push({ title: 'Failed to load labels', description: err.message });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setColor(PRESET_COLORS[0]);
    setFormOpen(true);
  };

  const openEdit = (label: WhatsappLabel) => {
    setEditing(label);
    setName(label.name);
    setColor(label.color);
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await whatsappFetch(token, `/labels/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name, color }) });
        push({ title: 'Label updated', description: name });
      } else {
        await whatsappFetch(token, '/labels', { method: 'POST', body: JSON.stringify({ name, color }) });
        push({ title: 'Label created', description: name });
      }
      setFormOpen(false);
      load(search);
    } catch (err: any) {
      push({ title: 'Failed to save label', description: err.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await whatsappFetch(token, `/labels/${deleteTarget.id}`, { method: 'DELETE' });
      push({ title: 'Label deleted', description: deleteTarget.name });
      setDeleteTarget(null);
      load(search);
    } catch (err: any) {
      push({ title: 'Failed to delete label', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Labels</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Tag contacts with labels like Customer, VIP, Lead, Supplier, Staff.</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New label</Button>
      </motion.div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search labels…" className="pl-10" />
      </div>

      {labels === undefined ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i}><Skeleton className="h-28 w-full" /></div>)}
        </div>
      ) : labels.length === 0 ? (
        <EmptyState icon={Tag} title="No labels yet" description="Create a label to tag and filter your contacts." action={<Button onClick={openCreate}>New label</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {labels.map((label) => (
            <Card key={label.id}>
              <CardContent className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
                  <div>
                    <Link to={`/whatsapp/contacts?labelId=${label.id}`} className="font-semibold text-[var(--text-primary)] hover:text-blue-300">{label.name}</Link>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{label.contactCount} contact{label.contactCount === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(label)} aria-label="Edit label"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(label)} aria-label="Delete label"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit label' : 'New label'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP" required />
            </label>
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">Color</p>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className="h-8 w-8 rounded-full border-2 transition"
                    style={{ backgroundColor: c, borderColor: color === c ? 'var(--text-primary)' : 'transparent' }}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit">{editing ? 'Save' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">Contacts with this label won't be deleted, only the label itself.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
