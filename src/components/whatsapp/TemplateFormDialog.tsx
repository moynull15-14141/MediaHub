import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { MessageComposer } from './MessageComposer';

const CATEGORIES = ['MARKETING', 'PROMOTION', 'REMINDER', 'GREETING', 'ANNOUNCEMENT', 'SUPPORT', 'INVOICE', 'OTP'];

interface TemplateDetail {
  id: string;
  name: string;
  category: string;
  messageText: string;
  isFavorite: boolean;
}

interface TemplateFormDialogProps {
  open: boolean;
  templateId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TemplateFormDialog({ open, templateId, onClose, onSaved }: TemplateFormDialogProps) {
  const { token } = useAuth();
  const { push } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('MARKETING');
  const [messageText, setMessageText] = useState('');
  const [nameWarning, setNameWarning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNameWarning(false);
    if (templateId) {
      setLoading(true);
      whatsappFetch<TemplateDetail[]>(token, '/templates')
        .then((templates) => {
          const found = templates.find((t) => t.id === templateId);
          if (found) {
            setName(found.name);
            setCategory(found.category);
            setMessageText(found.messageText);
          }
        })
        .catch((err) => push({ title: 'Failed to load template', description: err.message }))
        .finally(() => setLoading(false));
    } else {
      setName('');
      setCategory('MARKETING');
      setMessageText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { push({ title: 'Template name is required' }); return; }
    if (!messageText.trim()) { push({ title: 'Message is required' }); return; }

    setSaving(true);
    const payload = { name, category, messageText };
    try {
      let result: any;
      if (templateId) {
        result = await whatsappFetch(token, `/templates/${templateId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        result = await whatsappFetch(token, '/templates', { method: 'POST', body: JSON.stringify(payload) });
      }
      if (result.nameAlreadyExists) {
        setNameWarning(true);
      }
      push({ title: templateId ? 'Template updated' : 'Template created', description: name });
      onSaved();
      onClose();
    } catch (err: any) {
      push({ title: 'Failed to save template', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogContent className="max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{templateId ? 'Edit template' : 'New template'}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {nameWarning && (
              <div className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">A template with this name already exists. You can still save it.</div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Template name
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payment Reminder" required />
              </label>
              <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                Category
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
                </Select>
              </label>
            </div>

            <MessageComposer value={messageText} onChange={setMessageText} rows={8} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : templateId ? 'Save changes' : 'Create template'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
