import React, { useEffect, useRef, useState } from 'react';
import { Info, Users, MessageSquare, Paperclip, Eye, Search, X, FolderKanban, Tag, FileText, File as FileIcon, Film, Image as ImageIcon, UploadCloud, Loader2, FileStack } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { getApiBase } from '@/src/lib/api';
import { WhatsappMessagePreview } from './WhatsappMessagePreview';
import { MessageComposer, MAX_MESSAGE_LENGTH } from './MessageComposer';
import { QualityBadge } from './QualityBadge';

type RecipientSource = 'GROUP' | 'LABEL' | 'MANUAL';

interface RecipientEntry {
  contactId: string;
  name: string;
  phoneNumber: string;
  source: RecipientSource;
}

interface AttachmentInfo {
  id: string;
  type: 'IMAGE' | 'PDF' | 'DOCUMENT' | 'VIDEO';
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: string;
  previewUrl: string;
}

interface CampaignDetail {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  messageText: string;
  templateId: string | null;
  whatsappAccountId: string | null;
  recipientCount: number;
  recipients: RecipientEntry[];
  attachment: AttachmentInfo | null;
}

// Phase B.2 - Sending Account selector option. Deliberately a subset of the
// full WhatsappAccount shape in WhatsappAccounts.tsx - only what's needed to
// render and pick an account here.
interface SendingAccountOption {
  id: string;
  userId: string;
  businessName: string | null;
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  sendingEnabled: boolean;
  isDefault: boolean;
}

interface WhatsappGroup { id: string; name: string; }
interface WhatsappLabel { id: string; name: string; }
interface ContactSearchResult { id: string; name: string; phoneNumber: string; }

type TabKey = 'details' | 'audience' | 'message' | 'attachment' | 'preview';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'details', label: 'Details', icon: Info },
  { key: 'audience', label: 'Audience', icon: Users },
  { key: 'message', label: 'Message', icon: MessageSquare },
  { key: 'attachment', label: 'Attachment', icon: Paperclip },
  { key: 'preview', label: 'Preview', icon: Eye },
];

const attachmentIcon = (type: AttachmentInfo['type']) => {
  switch (type) {
    case 'IMAGE': return ImageIcon;
    case 'VIDEO': return Film;
    case 'PDF': return FileText;
    default: return FileIcon;
  }
};

interface MessageTemplateSummary {
  id: string;
  name: string;
  category: string;
  messageText: string;
}

interface CampaignFormDialogProps {
  open: boolean;
  campaignId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CampaignFormDialog({ open, campaignId, onClose, onSaved }: CampaignFormDialogProps) {
  const { token, user } = useAuth();
  const { push } = useToast();

  const [tab, setTab] = useState<TabKey>('details');
  const [loading, setLoading] = useState(false);
  const [serverId, setServerId] = useState<string | null>(campaignId);
  const [status, setStatus] = useState('DRAFT');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('OTHER');
  const [messageText, setMessageText] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sendingAccounts, setSendingAccounts] = useState<SendingAccountOption[] | undefined>(undefined);
  const [recipients, setRecipients] = useState(() => new Map<string, RecipientEntry>());
  const [attachment, setAttachment] = useState<AttachmentInfo | null>(null);
  const [nameWarning, setNameWarning] = useState(false);

  const [saving, setSaving] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const [groups, setGroups] = useState<WhatsappGroup[]>([]);
  const [labels, setLabels] = useState<WhatsappLabel[]>([]);
  const [groupToAdd, setGroupToAdd] = useState('');
  const [labelToAdd, setLabelToAdd] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [contactSearchResults, setContactSearchResults] = useState<ContactSearchResult[]>([]);

  const [previewContactId, setPreviewContactId] = useState('');
  const [previewRenderedText, setPreviewRenderedText] = useState<string | undefined>(undefined);

  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplateSummary[]>([]);

  const accountDefaultAttachmentKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('details');
    setServerId(campaignId);
    setStatus('DRAFT');
    setNameWarning(false);
    whatsappFetch<WhatsappGroup[]>(token, '/groups').then(setGroups).catch(() => {});
    whatsappFetch<WhatsappLabel[]>(token, '/labels').then(setLabels).catch(() => {});

    // Phase B.2 - Sending Account selector options. Workspace-wide list,
    // gated by campaigns:write (not settings:read) so Operators/Managers can
    // pick an account while building a campaign without broader account
    // access - see /campaigns/sending-accounts on the backend.
    setSendingAccounts(undefined);
    const accountsPromise = whatsappFetch<SendingAccountOption[]>(token, '/campaigns/sending-accounts')
      .then((list) => { setSendingAccounts(list); return list; })
      .catch(() => { setSendingAccounts([]); return [] as SendingAccountOption[]; });

    if (campaignId) {
      setLoading(true);
      whatsappFetch<CampaignDetail>(token, `/campaigns/${campaignId}`)
        .then((data) => {
          setName(data.name);
          setDescription(data.description || '');
          setType(data.type);
          setStatus(data.status);
          setMessageText(data.messageText);
          setTemplateId(data.templateId);
          setAccountId(data.whatsappAccountId);
          setAttachment(data.attachment);
          const map = new Map<string, RecipientEntry>();
          data.recipients.forEach((r) => map.set(r.contactId, r));
          setRecipients(map);
        })
        .catch((err) => push({ title: 'Failed to load campaign', description: err.message }))
        .finally(() => setLoading(false));
    } else {
      setName('');
      setDescription('');
      setType('OTHER');
      setMessageText('');
      setTemplateId(null);
      setAccountId(null);
      setAttachment(null);
      setRecipients(new Map());
      accountDefaultAttachmentKey.current = null;

      // Auto-select: exactly one account -> use it; else the workspace's
      // marked default, if any. Matches "auto select if only one account /
      // auto use default if one exists."
      accountsPromise.then((list) => {
        const resolvedId = list.length === 1 ? list[0].id : list.find((a) => a.isDefault)?.id ?? null;
        if (resolvedId) setAccountId(resolvedId);

        // Auto-fill from account-level campaign defaults (Phase 5 Settings) -
        // only for brand-new campaigns, never overwrites an existing draft.
        // The /account endpoint only ever returns the CALLER's own account,
        // and there's no endpoint to read a workspace-mate's defaults, so
        // this only applies when the resolved account is the caller's own
        // (or the workspace has no accounts yet, matching pre-B.2 behavior)
        // - a campaign auto-assigned to someone else's account starts blank
        // rather than guessing at defaults it can't actually fetch.
        const myAccount = list.find((a) => a.userId === user?.id);
        if (list.length > 0 && myAccount && resolvedId !== myAccount.id) return;

        whatsappFetch<any>(token, '/account')
          .then(async (account) => {
            if (!account) return;
            accountDefaultAttachmentKey.current = account.defaultAttachmentKey || null;
            if (account.defaultTemplateId) {
              try {
                const templateList = await whatsappFetch<MessageTemplateSummary[]>(token, '/templates');
                const template = templateList.find((t) => t.id === account.defaultTemplateId);
                if (template) {
                  const withFooter = account.defaultFooter ? `${template.messageText}\n\n${account.defaultFooter}` : template.messageText;
                  setMessageText(withFooter);
                  setTemplateId(template.id);
                }
              } catch {
                // default template lookup is best-effort - never block campaign creation
              }
            }
          })
          .catch(() => {});
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaignId]);

  useEffect(() => {
    if (!contactSearch.trim()) {
      setContactSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      whatsappFetch<{ contacts: ContactSearchResult[] }>(token, `/contacts?search=${encodeURIComponent(contactSearch)}&pageSize=15`)
        .then((res) => setContactSearchResults(res.contacts))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactSearch]);

  // Recipients are deduped by contactId; addRecipients reports how many of
  // the incoming entries were already selected so the caller can surface a
  // "N added, M duplicates removed" toast instead of silently dropping them.
  const addRecipients = (entries: RecipientEntry[]): { added: number; duplicates: number } => {
    let added = 0;
    let duplicates = 0;
    setRecipients((prev) => {
      const next = new Map(prev);
      entries.forEach((e) => {
        if (next.has(e.contactId)) {
          duplicates += 1;
        } else {
          next.set(e.contactId, e);
          added += 1;
        }
      });
      return next;
    });
    return { added, duplicates };
  };

  const handleAddGroup = async () => {
    if (!groupToAdd) return;
    try {
      const res = await whatsappFetch<{ contacts: ContactSearchResult[] }>(token, `/contacts?groupId=${groupToAdd}&pageSize=500`);
      const { added, duplicates } = addRecipients(res.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, source: 'GROUP' as const })));
      push({ title: 'Group added', description: duplicates > 0 ? `${added} contacts added, ${duplicates} duplicates removed.` : `${added} contact(s) added from group.` });
    } catch (err: any) {
      push({ title: 'Failed to add group', description: err.message });
    }
  };

  const handleAddLabel = async () => {
    if (!labelToAdd) return;
    try {
      const res = await whatsappFetch<{ contacts: ContactSearchResult[] }>(token, `/contacts?labelId=${labelToAdd}&pageSize=500`);
      const { added, duplicates } = addRecipients(res.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, source: 'LABEL' as const })));
      push({ title: 'Label added', description: duplicates > 0 ? `${added} contacts added, ${duplicates} duplicates removed.` : `${added} contact(s) added from label.` });
    } catch (err: any) {
      push({ title: 'Failed to add label', description: err.message });
    }
  };

  const removeRecipient = (contactId: string) => {
    setRecipients((prev) => {
      const next = new Map(prev);
      next.delete(contactId);
      return next;
    });
  };

  const overLimit = messageText.length > MAX_MESSAGE_LENGTH;

  const persist = async (): Promise<boolean> => {
    if (!name.trim()) { push({ title: 'Campaign name is required' }); setTab('details'); return false; }
    if (!messageText.trim()) { push({ title: 'Message is required' }); setTab('message'); return false; }
    if (overLimit) { push({ title: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` }); setTab('message'); return false; }
    if (recipients.size === 0) { push({ title: 'Select at least one recipient' }); setTab('audience'); return false; }
    // Only require a selection once the workspace actually has accounts to
    // choose from - a still-onboarding workspace with zero accounts must
    // still be able to save a draft (falls back to legacy userId resolution).
    if ((sendingAccounts?.length ?? 0) > 0 && !accountId) {
      push({ title: 'Select a sending account' });
      setTab('details');
      return false;
    }

    setSaving(true);
    const payload = {
      name,
      description: description || undefined,
      type,
      messageText,
      templateId,
      whatsappAccountId: accountId,
      recipients: [...recipients.values()].map((r: RecipientEntry) => ({ contactId: r.contactId, source: r.source })),
    };
    try {
      let result: any;
      const isCreate = !serverId;
      if (serverId) {
        result = await whatsappFetch(token, `/campaigns/${serverId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        result = await whatsappFetch(token, '/campaigns', { method: 'POST', body: JSON.stringify(payload) });
        setServerId(result.id);
      }
      setNameWarning(!!result.nameAlreadyExists);
      push({ title: 'Campaign saved', description: name });

      if (isCreate && !attachment && accountDefaultAttachmentKey.current) {
        try {
          const applied = await whatsappFetch<AttachmentInfo | null>(token, `/campaigns/${result.id}/attachment/apply-default`, { method: 'POST' });
          if (applied) setAttachment(applied);
        } catch {
          // default attachment is a convenience - never block campaign creation on it
        }
      }
      return true;
    } catch (err: any) {
      push({ title: 'Failed to save campaign', description: err.message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => { await persist(); };
  const handleSaveAndClose = async () => {
    const ok = await persist();
    if (ok) { onSaved(); onClose(); }
  };

  const handleMarkReady = async () => {
    if (!serverId) { push({ title: 'Save the campaign first' }); return; }
    try {
      await whatsappFetch(token, `/campaigns/${serverId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'READY' }) });
      setStatus('READY');
      push({ title: 'Campaign marked Ready' });
      onSaved();
    } catch (err: any) {
      push({ title: 'Could not mark Ready', description: err.message });
    }
  };

  const handleFileSelected = async (file: File) => {
    if (!serverId) {
      push({ title: 'Save the campaign first', description: 'Use "Save draft" below, then attach a file.' });
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    setUploadingAttachment(true);
    try {
      const res = await fetch(`${getApiBase()}/api/whatsapp/campaigns/${serverId}/attachment`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      setAttachment(body);
      push({ title: 'Attachment added', description: file.name });
    } catch (err: any) {
      push({ title: 'Attachment failed', description: err.message });
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = async () => {
    if (!serverId) return;
    try {
      await whatsappFetch(token, `/campaigns/${serverId}/attachment`, { method: 'DELETE' });
      setAttachment(null);
    } catch (err: any) {
      push({ title: 'Failed to remove attachment', description: err.message });
    }
  };

  const AttachmentIcon = attachment ? attachmentIcon(attachment.type) : null;

  // Live preview: instantly re-renders (debounced, no page refresh) against
  // whichever recipient is selected, reusing the same server-side render
  // engine as the Ready-status gate - never re-implemented client-side.
  useEffect(() => {
    if (!previewContactId) {
      setPreviewRenderedText(undefined);
      return;
    }
    const t = setTimeout(() => {
      whatsappFetch<{ renderedText: string }>(token, '/templates/preview', {
        method: 'POST',
        body: JSON.stringify({ messageText, contactId: previewContactId }),
      })
        .then((res) => setPreviewRenderedText(res.renderedText))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewContactId, messageText]);

  const openTemplatePicker = async () => {
    try {
      const list = await whatsappFetch<MessageTemplateSummary[]>(token, '/templates');
      setTemplates(list);
      setTemplatePickerOpen(true);
    } catch (err: any) {
      push({ title: 'Failed to load templates', description: err.message });
    }
  };

  const applyTemplate = (template: MessageTemplateSummary) => {
    if (messageText.trim() && !window.confirm('Replace the current message with this template?')) return;
    setMessageText(template.messageText);
    setTemplateId(template.id);
    setTemplatePickerOpen(false);
    push({ title: 'Template applied', description: template.name });
  };

  return (
    <>
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogContent className="max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{serverId ? 'Edit campaign' : 'Create campaign'}</DialogTitle>
          {serverId && (
            <div className="flex items-center gap-2">
              <Badge variant={status === 'READY' ? 'success' : status === 'ARCHIVED' ? 'outline' : 'warning'}>{status}</Badge>
              {status !== 'READY' && status !== 'ARCHIVED' && (
                <Button type="button" size="sm" variant="outline" onClick={handleMarkReady}>Mark Ready</Button>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="mb-4 flex flex-wrap gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${tab === t.key ? 'bg-blue-500/15 text-blue-300' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="min-h-[320px]">
            {tab === 'details' && (
              <div className="space-y-4">
                {nameWarning && (
                  <div className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">A campaign with this name already exists. You can still save it.</div>
                )}
                <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                  Campaign name
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid Sale Announcement" required />
                </label>
                <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                  Description (optional)
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block max-w-xs space-y-2 text-sm text-[var(--text-secondary)]">
                  Campaign type
                  <Select value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="PROMOTIONAL">Promotional</option>
                    <option value="UTILITY">Utility</option>
                    <option value="ANNOUNCEMENT">Announcement</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </label>
                {sendingAccounts === undefined ? (
                  <Skeleton className="h-14 w-full max-w-md" />
                ) : sendingAccounts.length > 0 ? (
                  <label className="block max-w-md space-y-2 text-sm text-[var(--text-secondary)]">
                    Sending account
                    <Select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
                      <option value="">Select an account…</option>
                      {sendingAccounts.map((a) => {
                        const label = a.businessName || a.verifiedName || a.displayPhoneNumber || 'WhatsApp account';
                        const usable = a.sendingEnabled && a.status === 'CONNECTED';
                        return (
                          <option key={a.id} value={a.id}>
                            {label} — {a.qualityRating ?? 'N/A'} · {a.messagingLimitTier ?? 'N/A'}{a.isDefault ? ' · Default' : ''}{!usable ? ' (unavailable)' : ''}
                          </option>
                        );
                      })}
                    </Select>
                    {accountId && (() => {
                      const selected = sendingAccounts.find((a) => a.id === accountId);
                      if (!selected) return null;
                      return (
                        <span className="flex items-center gap-2 pt-1">
                          <QualityBadge rating={selected.qualityRating} />
                          {(!selected.sendingEnabled || selected.status !== 'CONNECTED') && (
                            <Badge variant="danger">This account can't send right now</Badge>
                          )}
                        </span>
                      );
                    })()}
                  </label>
                ) : (
                  <p className="max-w-md rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)]">
                    No WhatsApp account connected yet - this campaign will use whichever account you connect before sending.
                  </p>
                )}
              </div>
            )}

            {tab === 'audience' && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-end gap-2">
                    <label className="block flex-1 space-y-2 text-sm text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1.5"><FolderKanban className="h-3.5 w-3.5" /> Add from group</span>
                      <Select value={groupToAdd} onChange={(e) => setGroupToAdd(e.target.value)}>
                        <option value="">Select a group…</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </Select>
                    </label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddGroup} disabled={!groupToAdd}>Add</Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="block flex-1 space-y-2 text-sm text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Add from label</span>
                      <Select value={labelToAdd} onChange={(e) => setLabelToAdd(e.target.value)}>
                        <option value="">Select a label…</option>
                        {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </Select>
                    </label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddLabel} disabled={!labelToAdd}>Add</Button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <Input value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Search contacts to add manually…" className="pl-10" />
                  {contactSearchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
                      {contactSearchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { addRecipients([{ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, source: 'MANUAL' }]); setContactSearch(''); setContactSearchResults([]); }}
                          className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-[var(--panel-bg)]"
                        >
                          <span className="text-[var(--text-primary)]">{c.name}</span>
                          <span className="text-[var(--text-secondary)]">{c.phoneNumber}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">{recipients.size} recipient{recipients.size === 1 ? '' : 's'} selected</p>
                  {recipients.size === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">No recipients yet. Add from a group, a label, or search contacts above.</p>
                  ) : (
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-[var(--border)] p-2">
                      {[...recipients.values()].map((r: RecipientEntry) => (
                        <div key={r.contactId} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-[var(--panel-bg)]">
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--text-primary)]">{r.name}</span>
                            <span className="text-[var(--text-secondary)]">{r.phoneNumber}</span>
                            <Badge variant="outline">{r.source}</Badge>
                          </div>
                          <button type="button" onClick={() => removeRecipient(r.contactId)} aria-label={`Remove ${r.name}`} className="text-[var(--text-secondary)] hover:text-rose-300">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'message' && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={openTemplatePicker}>
                    <FileStack className="mr-2 h-3.5 w-3.5" /> Use template
                  </Button>
                </div>
                <MessageComposer value={messageText} onChange={setMessageText} />
              </div>
            )}

            {tab === 'attachment' && (
              <div className="space-y-4">
                {!serverId ? (
                  <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">Save the campaign as a draft first, then come back here to attach a file.</p>
                ) : attachment ? (
                  <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] p-4">
                    {attachment.type === 'IMAGE' ? (
                      <img src={attachment.previewUrl} alt={attachment.originalFilename} className="h-20 w-20 rounded-xl object-cover" />
                    ) : (
                      AttachmentIcon && <AttachmentIcon className="h-10 w-10 text-[var(--text-secondary)]" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{attachment.originalFilename}</p>
                      <p className="text-xs text-[var(--text-secondary)]">{attachment.type} · {(Number(attachment.fileSizeBytes) / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                    <div className="flex gap-2">
                      <label className="cursor-pointer">
                        <span className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--panel-bg)]">Change</span>
                        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); }} />
                      </label>
                      <Button type="button" variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={handleRemoveAttachment}>Remove</Button>
                    </div>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--border)] px-6 py-12 text-center hover:border-blue-500">
                    {uploadingAttachment ? <Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" /> : <UploadCloud className="h-8 w-8 text-[var(--text-secondary)]" />}
                    <span className="text-sm font-medium text-[var(--text-primary)]">{uploadingAttachment ? 'Uploading…' : 'Click to attach an image, PDF, document, or video'}</span>
                    <span className="text-xs text-[var(--text-muted)]">Image ≤5MB · Video ≤16MB · PDF/Document ≤100MB</span>
                    <input type="file" className="hidden" disabled={uploadingAttachment} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); }} />
                  </label>
                )}
              </div>
            )}

            {tab === 'preview' && (
              <div className="space-y-4">
                <label className="block max-w-xs space-y-2 text-sm text-[var(--text-secondary)]">
                  Preview contact
                  <Select value={previewContactId} onChange={(e) => setPreviewContactId(e.target.value)}>
                    <option value="">Sample data</option>
                    {[...recipients.values()].map((r: RecipientEntry) => (
                      <option key={r.contactId} value={r.contactId}>{r.name}</option>
                    ))}
                  </Select>
                </label>
                <WhatsappMessagePreview
                  messageText={messageText}
                  attachment={attachment}
                  recipientCount={recipients.size}
                  renderedText={previewContactId ? previewRenderedText : undefined}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</Button>
          <Button type="button" onClick={handleSaveAndClose} disabled={saving}>{saving ? 'Saving…' : 'Save & close'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={templatePickerOpen} onClose={() => setTemplatePickerOpen(false)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Use a template</DialogTitle></DialogHeader>
        {templates.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">No templates yet. Create one from the Templates page.</p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="flex w-full flex-col items-start gap-1 rounded-xl px-4 py-3 text-left text-sm hover:bg-[var(--panel-bg)]"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-primary)]">{t.name}</span>
                  <Badge variant="outline">{t.category}</Badge>
                </span>
                <span className="line-clamp-1 text-xs text-[var(--text-secondary)]">{t.messageText}</span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setTemplatePickerOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
