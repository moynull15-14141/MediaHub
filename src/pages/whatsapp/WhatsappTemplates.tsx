import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { FileStack, Plus, Pencil, Copy, Trash2, Search, Star } from 'lucide-react';
import { Card, CardContent } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { TemplateFormDialog } from '@/src/components/whatsapp/TemplateFormDialog';

interface MessageTemplate {
  id: string;
  name: string;
  category: string;
  messageText: string;
  isFavorite: boolean;
  updatedAt: string;
}

const CATEGORIES = ['MARKETING', 'PROMOTION', 'REMINDER', 'GREETING', 'ANNOUNCEMENT', 'SUPPORT', 'INVOICE', 'OTP'];

export default function WhatsappTemplates() {
  const { token } = useAuth();
  const { push } = useToast();

  const [templates, setTemplates] = useState<MessageTemplate[] | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);

  const load = async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (favoriteOnly) params.set('favorite', 'true');
    try {
      const result = await whatsappFetch<MessageTemplate[]>(token, `/templates?${params.toString()}`);
      setTemplates(result);
    } catch (err: any) {
      push({ title: 'Failed to load templates', description: err.message });
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, favoriteOnly]);

  const openCreate = () => { setEditingId(null); setFormOpen(true); };
  const openEdit = (id: string) => { setEditingId(id); setFormOpen(true); };

  const handleDuplicate = async (template: MessageTemplate) => {
    try {
      await whatsappFetch(token, `/templates/${template.id}/duplicate`, { method: 'POST' });
      push({ title: 'Template duplicated', description: template.name });
      load();
    } catch (err: any) {
      push({ title: 'Failed to duplicate template', description: err.message });
    }
  };

  const handleToggleFavorite = async (template: MessageTemplate) => {
    try {
      await whatsappFetch(token, `/templates/${template.id}/favorite`, { method: 'PATCH', body: JSON.stringify({ isFavorite: !template.isFavorite }) });
      load();
    } catch (err: any) {
      push({ title: 'Failed to update favorite', description: err.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await whatsappFetch(token, `/templates/${deleteTarget.id}`, { method: 'DELETE' });
      push({ title: 'Template deleted', description: deleteTarget.name });
      setDeleteTarget(null);
      load();
    } catch (err: any) {
      push({ title: 'Failed to delete template', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Templates</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Reusable message templates you can start a campaign from.</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New template</Button>
      </motion.div>

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" className="pl-10" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="max-w-[180px]">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
        </Select>
        <Button variant={favoriteOnly ? 'default' : 'outline'} size="sm" onClick={() => setFavoriteOnly((v) => !v)}>
          <Star className={favoriteOnly ? 'mr-2 h-4 w-4 fill-current' : 'mr-2 h-4 w-4'} /> Favorites
        </Button>
      </div>

      {templates === undefined ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i}><Skeleton className="h-36 w-full" /></div>)}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={FileStack} title="No templates yet" description="Create a reusable template to speed up building campaigns." action={<Button onClick={openCreate}>New template</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{template.name}</p>
                    <Badge variant="outline" className="mt-1">{template.category}</Badge>
                  </div>
                  <button type="button" onClick={() => handleToggleFavorite(template)} aria-label="Toggle favorite">
                    <Star className={template.isFavorite ? 'h-5 w-5 fill-amber-400 text-amber-400' : 'h-5 w-5 text-[var(--text-secondary)]'} />
                  </button>
                </div>
                <p className="line-clamp-3 text-sm text-[var(--text-secondary)]">{template.messageText}</p>
                <div className="mt-auto flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(template.id)} aria-label="Edit template"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDuplicate(template)} aria-label="Duplicate template"><Copy className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(template)} aria-label="Delete template"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateFormDialog open={formOpen} templateId={editingId} onClose={() => setFormOpen(false)} onSaved={load} />

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
    </div>
  );
}
