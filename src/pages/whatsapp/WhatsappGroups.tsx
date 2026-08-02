import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { FolderKanban, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface WhatsappGroup {
  id: string;
  name: string;
  contactCount: number;
  createdAt: string;
}

export default function WhatsappGroups() {
  const { token } = useAuth();
  const { push } = useToast();
  const [groups, setGroups] = useState<WhatsappGroup[] | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WhatsappGroup | null>(null);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WhatsappGroup | null>(null);

  const load = async (q?: string) => {
    try {
      const result = await whatsappFetch<WhatsappGroup[]>(token, `/groups${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      setGroups(result);
    } catch (err: any) {
      push({ title: 'Failed to load groups', description: err.message });
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
    setFormOpen(true);
  };

  const openEdit = (group: WhatsappGroup) => {
    setEditing(group);
    setName(group.name);
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await whatsappFetch(token, `/groups/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
        push({ title: 'Group renamed', description: name });
      } else {
        await whatsappFetch(token, '/groups', { method: 'POST', body: JSON.stringify({ name }) });
        push({ title: 'Group created', description: name });
      }
      setFormOpen(false);
      load(search);
    } catch (err: any) {
      push({ title: 'Failed to save group', description: err.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await whatsappFetch(token, `/groups/${deleteTarget.id}`, { method: 'DELETE' });
      push({ title: 'Group deleted', description: deleteTarget.name });
      setDeleteTarget(null);
      load(search);
    } catch (err: any) {
      push({ title: 'Failed to delete group', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Groups</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Organize contacts into groups.</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New group</Button>
      </motion.div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search groups…" className="pl-10" />
      </div>

      {groups === undefined ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i}><Skeleton className="h-28 w-full" /></div>)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No groups yet" description="Create a group to organize your contacts." action={<Button onClick={openCreate}>New group</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">{group.name}</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{group.contactCount} contact{group.contactCount === 1 ? '' : 's'}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(group)} aria-label="Rename group"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(group)} aria-label="Delete group"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Rename group' : 'New group'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP Customers" required />
            </label>
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
          <p className="text-sm text-[var(--text-muted)]">Contacts in this group won't be deleted, only the group itself.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
