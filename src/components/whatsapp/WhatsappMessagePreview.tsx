import { useState } from 'react';
import { Monitor, Smartphone, FileText, File as FileIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';

const SAMPLE_VALUES: Record<string, string> = {
  name: 'John Doe',
  company: 'Acme Inc',
  phone: '+1 555 0123',
};

export const substituteSampleVariables = (text: string): string =>
  text.replace(/\{\{(\w+)\}\}/g, (match, key) => SAMPLE_VALUES[key] ?? match);

interface AttachmentPreview {
  type: 'IMAGE' | 'PDF' | 'DOCUMENT' | 'VIDEO';
  originalFilename: string;
  previewUrl: string;
}

interface WhatsappMessagePreviewProps {
  messageText: string;
  attachment?: AttachmentPreview | null;
  recipientCount: number;
  /** Server-rendered text for a specific contact (from /templates/preview). When
   *  omitted, falls back to the original static sample-value substitution. */
  renderedText?: string;
}

export function WhatsappMessagePreview({ messageText, attachment, recipientCount, renderedText }: WhatsappMessagePreviewProps) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('mobile');
  const resolvedText = renderedText !== undefined ? renderedText : substituteSampleVariables(messageText || '');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Preview</p>
        <div className="flex gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-1">
          <button
            type="button"
            onClick={() => setMode('desktop')}
            className={cn('flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition', mode === 'desktop' ? 'bg-blue-500/15 text-blue-300' : 'text-[var(--text-secondary)]')}
          >
            <Monitor className="h-3.5 w-3.5" /> Desktop
          </button>
          <button
            type="button"
            onClick={() => setMode('mobile')}
            className={cn('flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition', mode === 'mobile' ? 'bg-blue-500/15 text-blue-300' : 'text-[var(--text-secondary)]')}
          >
            <Smartphone className="h-3.5 w-3.5" /> Mobile
          </button>
        </div>
      </div>

      <div
        className={cn(
          'mx-auto overflow-hidden rounded-3xl border border-black/10 shadow-lg transition-all',
          mode === 'mobile' ? 'w-full max-w-[300px]' : 'w-full max-w-xl'
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#075e54' }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white">B</div>
          <div>
            <p className="text-sm font-semibold text-white">Your Business</p>
            <p className="text-[11px] text-white/70">WhatsApp Business</p>
          </div>
        </div>

        <div
          className="flex min-h-[220px] flex-col justify-end gap-2 px-3 py-4"
          style={{
            backgroundColor: '#e5ddd5',
            backgroundImage:
              'linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none px-2 py-2 text-sm shadow" style={{ backgroundColor: '#dcf8c6' }}>
            {attachment && (
              <div className="mb-2 overflow-hidden rounded-md">
                {attachment.type === 'IMAGE' && (
                  <img src={attachment.previewUrl} alt={attachment.originalFilename} className="max-h-48 w-full object-cover" />
                )}
                {attachment.type === 'VIDEO' && (
                  <video src={attachment.previewUrl} controls className="max-h-48 w-full" />
                )}
                {(attachment.type === 'PDF' || attachment.type === 'DOCUMENT') && (
                  <div className="flex items-center gap-2 rounded-md bg-white/60 px-2 py-2">
                    {attachment.type === 'PDF' ? <FileText className="h-6 w-6 text-rose-600" /> : <FileIcon className="h-6 w-6 text-blue-600" />}
                    <span className="truncate text-xs text-gray-700">{attachment.originalFilename}</span>
                  </div>
                )}
              </div>
            )}
            {resolvedText ? (
              <p className="whitespace-pre-wrap break-words text-gray-900">{resolvedText}</p>
            ) : (
              <p className="italic text-gray-400">Your message will appear here…</p>
            )}
            <div className="mt-1 flex justify-end gap-1 text-[10px] text-gray-500">
              <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-[var(--text-secondary)]">
        Will be sent to <span className="font-semibold text-[var(--text-primary)]">{recipientCount}</span> recipient{recipientCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
