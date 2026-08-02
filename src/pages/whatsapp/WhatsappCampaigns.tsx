import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Megaphone, Plus, Pencil, Copy, Archive, Trash2, Search, ChevronLeft, ChevronRight, Send, Activity } from 'lucide-react';
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
import { CampaignFormDialog } from '@/src/components/whatsapp/CampaignFormDialog';
import { ScheduleCampaignDialog } from '@/src/components/whatsapp/ScheduleCampaignDialog';
import { CampaignProgressDialog } from '@/src/components/whatsapp/CampaignProgressDialog';

type SendStatus = 'NOT_STARTED' | 'SCHEDULED' | 'QUEUED' | 'SENDING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  sendStatus: SendStatus;
  scheduledAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  recipientCount: number;
  hasAttachment: boolean;
}

const statusVariant = (status: Campaign['status']) => (status === 'READY' ? 'success' : status === 'ARCHIVED' ? 'outline' : 'warning');

const sendStatusVariant = (status: SendStatus) => {
  switch (status) {
    case 'SENDING': return 'warning';
    case 'COMPLETED': return 'success';
    case 'FAILED': return 'danger';
    case 'PAUSED':
    case 'CANCELLED':
    case 'NOT_STARTED': return 'outline';
    default: return 'default';
  }
};

export default function WhatsappCampaigns() {
  const { token } = useAuth();
  const { push } = useToast();

  const [campaigns, setCampaigns] = useState<Campaign[] | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [progressTarget, setProgressTarget] = useState<Campaign | null>(null);

  const pageSize = 20;

  const load = async () => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    try {
      const result = await whatsappFetch<{ campaigns: Campaign[]; total: number; totalPages: number }>(token, `/campaigns?${params.toString()}`);
      setCampaigns(result.campaigns);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      push({ title: 'Failed to load campaigns', description: err.message });
    }
  };

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const openCreate = () => { setEditingId(null); setFormOpen(true); };
  const openEdit = (id: string) => { setEditingId(id); setFormOpen(true); };

  const handleDuplicate = async (campaign: Campaign) => {
    try {
      await whatsappFetch(token, `/campaigns/${campaign.id}/duplicate`, { method: 'POST' });
      push({ title: 'Campaign duplicated', description: campaign.name });
      load();
    } catch (err: any) {
      push({ title: 'Failed to duplicate campaign', description: err.message });
    }
  };

  const handleArchive = async (campaign: Campaign) => {
    try {
      await whatsappFetch(token, `/campaigns/${campaign.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED' }) });
      push({ title: 'Campaign archived', description: campaign.name });
      load();
    } catch (err: any) {
      push({ title: 'Failed to archive campaign', description: err.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await whatsappFetch(token, `/campaigns/${deleteTarget.id}`, { method: 'DELETE' });
      push({ title: 'Campaign deleted', description: deleteTarget.name });
      setDeleteTarget(null);
      load();
    } catch (err: any) {
      push({ title: 'Failed to delete campaign', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{total} campaign{total === 1 ? '' : 's'} built so far.</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New campaign</Button>
      </motion.div>

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" className="pl-10" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[160px]">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="READY">Ready</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>

      {campaigns === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns yet" description="Create your first campaign to start building a message for your audience." action={<Button onClick={openCreate}>New campaign</Button>} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">
                    <button type="button" onClick={() => openEdit(campaign.id)} className="text-left hover:text-blue-300">{campaign.name}</button>
                    {campaign.description && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{campaign.description}</p>}
                  </TableCell>
                  <TableCell>{campaign.type}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={statusVariant(campaign.status)}>{campaign.status}</Badge>
                      {campaign.sendStatus !== 'NOT_STARTED' && (
                        <Badge variant={sendStatusVariant(campaign.sendStatus) as any}>{campaign.sendStatus}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{campaign.recipientCount}</TableCell>
                  <TableCell>{new Date(campaign.updatedAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {campaign.status === 'READY' && ['NOT_STARTED', 'COMPLETED', 'CANCELLED', 'FAILED'].includes(campaign.sendStatus) && (
                        <Button variant="ghost" size="icon" onClick={() => setSendTarget(campaign)} aria-label="Send campaign"><Send className="h-4 w-4 text-blue-300" /></Button>
                      )}
                      {campaign.sendStatus !== 'NOT_STARTED' && (
                        <Button variant="ghost" size="icon" onClick={() => setProgressTarget(campaign)} aria-label="View progress"><Activity className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => openEdit(campaign.id)} aria-label="Edit campaign"><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDuplicate(campaign)} aria-label="Duplicate campaign"><Copy className="h-4 w-4" /></Button>
                      {campaign.status !== 'ARCHIVED' && (
                        <Button variant="ghost" size="icon" onClick={() => handleArchive(campaign)} aria-label="Archive campaign"><Archive className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(campaign)} aria-label="Delete campaign"><Trash2 className="h-4 w-4 text-rose-300" /></Button>
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

      <CampaignFormDialog
        open={formOpen}
        campaignId={editingId}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />

      <ScheduleCampaignDialog
        open={!!sendTarget}
        campaignId={sendTarget?.id ?? null}
        campaignName={sendTarget?.name}
        onClose={() => setSendTarget(null)}
        onDone={load}
      />

      <CampaignProgressDialog
        open={!!progressTarget}
        campaignId={progressTarget?.id ?? null}
        campaignName={progressTarget?.name}
        onClose={() => setProgressTarget(null)}
        onChanged={load}
      />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">This action cannot be undone. Any attached file will also be removed.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-500" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
