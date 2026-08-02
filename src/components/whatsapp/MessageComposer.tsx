import { useEffect, useRef, useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { useAuth } from '@/src/components/auth/AuthContext';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { EmojiPickerButton } from './EmojiPickerButton';

export const MAX_MESSAGE_LENGTH = 4096;

interface VariableStatus {
  token: string;
  key: string;
  normalizedKey: string;
  status: 'valid' | 'unknown';
  suggestion?: string;
}

interface MalformedEntry {
  snippet: string;
  reason: string;
}

export interface PreviewResult {
  renderedText: string;
  variables: VariableStatus[];
  duplicates: string[];
  malformed: MalformedEntry[];
  isValid: boolean;
}

interface AvailableVariables {
  standard: string[];
  custom: string[];
}

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}

// Shared variable-aware message editor used by both the Campaign Builder's
// Message tab and the Template editor - one implementation for the emoji
// picker, variable insertion, live inspector, and counter, so neither place
// re-implements this logic.
export function MessageComposer({ value, onChange, rows = 10 }: MessageComposerProps) {
  const { token } = useAuth();
  const [available, setAvailable] = useState<AvailableVariables>({ standard: [], custom: [] });
  const [inspector, setInspector] = useState<PreviewResult | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    whatsappFetch<AvailableVariables>(token, '/templates/variables').then(setAvailable).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value.trim()) {
      setInspector(null);
      return;
    }
    const t = setTimeout(() => {
      whatsappFetch<PreviewResult>(token, '/templates/preview', { method: 'POST', body: JSON.stringify({ messageText: value }) })
        .then(setInspector)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  };

  const insertVariable = (key: string) => insertAtCursor(`{{${key}}}`);

  const applySuggestion = (badKey: string, suggestion: string) => {
    onChange(value.split(`{{${badKey}}}`).join(`{{${suggestion}}}`));
  };

  const charCount = value.length;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const byteSize = new TextEncoder().encode(value).length;
  const overLimit = charCount > MAX_MESSAGE_LENGTH;
  const nearLimit = !overLimit && charCount > MAX_MESSAGE_LENGTH * 0.9;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <EmojiPickerButton onSelect={insertAtCursor} />
          {['name', 'phone', 'company'].map((v) => (
            <Button key={v} type="button" size="sm" variant="outline" onClick={() => insertVariable(v)}>{`{{${v}}}`}</Button>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder="Write your message… use {{name}}, {{balance}}, or any contact field as a variable."
          className="w-full rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={overLimit ? 'font-semibold text-rose-300' : nearLimit ? 'font-semibold text-amber-300' : 'text-[var(--text-secondary)]'}>
            {charCount} characters · {wordCount} words · ~{byteSize} bytes
          </span>
          <span className={overLimit ? 'font-semibold text-rose-300' : 'text-[var(--text-muted)]'}>
            {charCount} / {MAX_MESSAGE_LENGTH}
          </span>
        </div>

        {inspector && inspector.malformed.length > 0 && (
          <div className="space-y-1 rounded-2xl bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {inspector.malformed.map((m, i) => (
              <p key={i}>{m.reason}: "{m.snippet}"</p>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-[var(--border)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Available variables</p>
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-[11px] text-[var(--text-muted)]">Standard</p>
              <div className="flex flex-wrap gap-1">
                {available.standard.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => insertVariable(k)}
                    className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:border-blue-500"
                  >{`{{${k}}}`}</button>
                ))}
              </div>
            </div>
            {available.custom.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] text-[var(--text-muted)]">Custom</p>
                <div className="flex flex-wrap gap-1">
                  {available.custom.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => insertVariable(k)}
                      className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:border-blue-500"
                    >{`{{${k}}}`}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Detected variables</p>
          {!inspector || inspector.variables.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No variables in your message yet.</p>
          ) : (
            <div className="space-y-2">
              {inspector.variables.map((v, i) => (
                <div key={`${v.normalizedKey}-${i}`} className="text-xs">
                  {v.status === 'valid' ? (
                    <span className="flex items-center gap-1 text-emerald-300">
                      <Check className="h-3 w-3" /> {`{{${v.key}}}`}
                    </span>
                  ) : (
                    <div>
                      <span className="flex items-center gap-1 text-rose-300">
                        <AlertTriangle className="h-3 w-3" /> {`{{${v.key}}}`} unknown
                      </span>
                      {v.suggestion && (
                        <button
                          type="button"
                          onClick={() => applySuggestion(v.key, v.suggestion!)}
                          className="mt-0.5 text-[11px] text-blue-300 hover:text-blue-200"
                        >
                          Did you mean {`{{${v.suggestion}}}`}?
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
