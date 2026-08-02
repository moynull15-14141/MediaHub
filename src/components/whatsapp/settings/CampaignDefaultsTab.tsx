import { useEffect, useState } from 'react';
import { FileStack, Smartphone, UploadCloud, Trash2, FileText, File as FileIcon, Image as ImageIcon, Film } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Select } from '@/src/components/ui/select';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { getApiBase } from '@/src/lib/api';

interface MessageTemplateSummary { id: string; name: string; }

interface AccountDefaults {
  displayPhoneNumber: string | null;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  maxRetries: number;
  defaultTemplateId: string | null;
  defaultFooter: string | null;
  defaultAttachmentType: string | null;
  defaultAttachmentFilename: string | null;
}

const attachmentIcon = (type: string | null) => {
  switch (type) {
    case 'IMAGE': return ImageIcon;
    case 'VIDEO': return Film;
    case 'PDF': return FileText;
    default: return FileIcon;
  }
};

export function CampaignDefaultsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [account, setAccount] = useState<AccountDefaults | null | undefined>(undefined);
  const [templates, setTemplates] = useState<MessageTemplateSummary[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState('');
  const [defaultFooter, setDefaultFooter] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const [acc, tpl] = await Promise.all([
        whatsappFetch<AccountDefaults | null>(token, '/account'),
        whatsappFetch<MessageTemplateSummary[]>(token, '/templates'),
      ]);
      setAccount(acc);
      setTemplates(tpl);
      setDefaultTemplateId(acc?.defaultTemplateId || '');
      setDefaultFooter(acc?.defaultFooter || '');
    } catch (err: any) {
      push({ title: 'Failed to load campaign defaults', description: err.message });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await whatsappFetch(token, '/account/settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultTemplateId: defaultTemplateId || null, defaultFooter: defaultFooter || null }),
      });
      push({ title: 'Campaign defaults saved', description: 'These auto-fill new campaigns.' });
      load();
    } catch (err: any) {
      push({ title: 'Failed to save defaults', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleAttachmentUpload = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${getApiBase()}/api/whatsapp/account/default-attachment`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      push({ title: 'Default attachment set', description: file.name });
      load();
    } catch (err: any) {
      push({ title: 'Upload failed', description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleAttachmentRemove = async () => {
    try {
      await whatsappFetch(token, '/account/default-attachment', { method: 'DELETE' });
      load();
    } catch (err: any) {
      push({ title: 'Failed to remove default attachment', description: err.message });
    }
  };

  if (account === undefined) return <Skeleton className="h-72 w-full" />;
  if (!account) return <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to configure campaign defaults.</CardContent></Card>;

  const AttachmentIcon = attachmentIcon(account.defaultAttachmentType);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><FileStack className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Campaign defaults</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-[var(--text-muted)]">These values automatically fill in when you create a new campaign - you can still change them per campaign.</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Default sender</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><Smartphone className="h-4 w-4" /> {account.displayPhoneNumber || 'Not connected'}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Only one account is supported - nothing to choose.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Default delay / retry</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{account.minDelaySeconds}-{account.maxDelaySeconds}s, {account.maxRetries} retries</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Configured on the Queue tab - applies to every campaign automatically.</p>
            </div>
          </div>

          <label className="block max-w-sm space-y-2 text-sm text-[var(--text-secondary)]">
            Default template
            <Select value={defaultTemplateId} onChange={(e) => setDefaultTemplateId(e.target.value)}>
              <option value="">None</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>

          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
            Default footer
            <textarea
              value={defaultFooter}
              onChange={(e) => setDefaultFooter(e.target.value)}
              rows={2}
              placeholder="e.g. Reply STOP to unsubscribe"
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500"
            />
          </label>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save defaults'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">Default attachment</CardTitle></CardHeader>
        <CardContent>
          {account.defaultAttachmentFilename ? (
            <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] p-4">
              <AttachmentIcon className="h-8 w-8 text-[var(--text-secondary)]" />
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">{account.defaultAttachmentFilename}</p>
                <p className="text-xs text-[var(--text-secondary)]">{account.defaultAttachmentType}</p>
              </div>
              <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={handleAttachmentRemove}><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--border)] px-6 py-10 text-center hover:border-blue-500">
              <UploadCloud className="h-7 w-7 text-[var(--text-secondary)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">{uploading ? 'Uploading…' : 'Click to set a default attachment'}</span>
              <input type="file" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachmentUpload(f); }} />
            </label>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
