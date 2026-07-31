import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Loader2, PlayCircle, Download, ShieldCheck, Zap, Server, Copy, Share2, Sparkles, BadgeCheck, RotateCcw } from 'lucide-react';
import { Input } from '@/src/components/ui/input';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { useToast } from '@/src/components/ui/toast-provider';
import { useAuth } from '@/src/components/auth/AuthContext';
import { getApiBase } from '@/src/lib/api';
import type { MediaMetadata } from '../../server/services/media.service';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const { push } = useToast();
  const { token } = useAuth();

  const apiBase = getApiBase();
  const isImageResult = metadata?.formats[0]?.type === 'image';

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsLoading(true);
    setError(null);
    setMetadata(null);

    try {
      const res = await fetch(`${apiBase}/api/media/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'We could not analyze this link. Please verify the URL and try again.');
      }

      const data = body;
      setMetadata(data);
      push({ title: 'Analysis complete', description: 'Your media details are ready to review.' });
    } catch (err: any) {
      setError(err.message || 'An unexpected issue occurred while analyzing the media.');
      push({ title: 'Analysis failed', description: 'Please try another URL or check the connection.' });
    } finally {
      setIsLoading(false);
    }
  };

  const triggerBlobDownload = async (downloadUrl: string, startMessage: { title: string; description: string }) => {
    push(startMessage);
    try {
      const res = await fetch(downloadUrl);
      const contentType = res.headers.get('content-type') || '';

      if (!res.ok || contentType.includes('application/json')) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'The file could not be prepared. Try a different format or link.');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || 'download';

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      push({ title: 'Download ready', description: `${filename} has been saved.` });
    } catch (err: any) {
      push({ title: 'Download failed', description: err.message || 'Something went wrong while preparing the file.' });
    }
  };

  const handleDownload = (format: any) => {
    const params = new URLSearchParams({
      url,
      formatId: format.formatId,
      formatType: format.type,
      formatHasVideo: format.hasVideo ? 'true' : 'false',
      formatHasAudio: format.hasAudio ? 'true' : 'false',
      title: metadata?.title || 'download',
      ext: format.ext,
      ...(token ? { authToken: token } : {}),
    });
    triggerBlobDownload(`${apiBase}/api/media/download?${params.toString()}`, {
      title: 'Preparing download',
      description: `${format.quality} is being prepared.`,
    });
  };

  const handleDownloadAudio = () => {
    if (!metadata) return;

    const params = new URLSearchParams({
      url,
      title: metadata.title || 'download',
      ext: 'mp3',
      ...(token ? { authToken: token } : {}),
    });

    triggerBlobDownload(`${apiBase}/api/media/download/audio?${params.toString()}`, {
      title: 'Preparing audio download',
      description: 'Audio-only extraction is being prepared.',
    });
  };

  const handleRefresh = () => {
    setUrl('');
    setMetadata(null);
    setError(null);
    push({ title: 'Ready for new analysis', description: 'You can paste another link to analyze.' });
  };

  const quickFacts = useMemo(() => [
    { title: 'Lightning fast', description: 'Instant metadata extraction with a refined streaming pipeline.', icon: Zap },
    { title: 'Secure by default', description: 'Protected with strict validation and access controls.', icon: ShieldCheck },
    { title: 'Deployment ready', description: 'Built to ship cleanly via Docker and cloud hosting.', icon: Server },
  ], []);

  return (
    <div className="space-y-8">
      <AnimatePresence mode="wait">
        {!metadata ? (
          <motion.section key="hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="rounded-[2rem] border border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_40%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-6 shadow-[var(--shadow-card)] md:p-10">
            <div className="mx-auto max-w-3xl text-center">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300">
                <Sparkles className="h-4 w-4" /> Premium media intelligence
              </motion.div>
              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-5xl">
                Analyze and download media with enterprise confidence.
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[var(--text-muted)] md:text-lg">
                Paste any media link and get a polished analysis, rich format details, and instant download actions without leaving the experience.
              </motion.p>
            </div>

            <motion.section initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }} className="mx-auto mt-8 max-w-3xl">
              <form onSubmit={handleAnalyze} className="relative overflow-hidden rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)]/90 p-2 shadow-[var(--shadow-soft)]">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-cyan-500/5 to-indigo-500/10" />
                <div className="relative grid gap-3 rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
                    <Search className="h-5 w-5 text-[var(--text-secondary)]" />
                    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://platform.com/video/123" className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-0" type="url" required />
                  </div>
                  <button type="submit" disabled={isLoading} className="w-full rounded-2xl button-primary px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 md:w-auto md:min-w-[12rem]">
                    {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing</> : 'Analyze Media'}
                  </button>
                </div>
              </form>
              {error && <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
            </motion.section>
          </motion.section>
        ) : (
          <motion.section key="result-top" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="rounded-[2rem] border border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_40%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-6 shadow-[var(--shadow-card)] md:p-10">
            <div className="mx-auto max-w-3xl text-center">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300">
                <BadgeCheck className="h-4 w-4" /> Analysis complete
              </motion.div>
              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-5xl">
                {metadata.title}
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[var(--text-muted)] md:text-lg">
                Ready to download high-quality media or extract audio instantly.
              </motion.p>
            </div>

            <div className="mx-auto mt-8 max-w-3xl">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 text-[var(--text-primary)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--text-secondary)]">Resolution</p>
                  <p className="mt-2 text-2xl font-semibold">{metadata.formats[0]?.quality || 'Best available'}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 text-[var(--text-primary)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--text-secondary)]">Available formats</p>
                  <p className="mt-2 text-2xl font-semibold">{metadata.formats.length}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 text-[var(--text-primary)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--text-secondary)]">Estimated size</p>
                  <p className="mt-2 text-2xl font-semibold">{metadata.fileSize}</p>
                </div>
              </div>
            </div>

            <div className="mx-auto mt-8 max-w-3xl grid gap-4 md:grid-cols-3">
              <button onClick={() => handleDownload(metadata.formats[0])} className="flex w-full items-center justify-center gap-2 rounded-2xl button-primary px-4 py-4 text-sm font-semibold transition">
                <Download className="h-4 w-4" /> Download now
              </button>
              {!isImageResult && (
                <button onClick={handleDownloadAudio} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-4 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">
                  <Download className="h-4 w-4" /> Download audio only
                </button>
              )}
              <button onClick={handleRefresh} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-4 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">
                <RotateCcw className="h-4 w-4" /> Analyze again
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6">
              <Skeleton className="h-8 w-40" />
              <div className="mt-6 grid gap-4 md:grid-cols-[220px_1fr]">
                <Skeleton className="h-40 w-full" />
                <div className="space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              </div>
            </div>
            <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6">
              <Skeleton className="h-8 w-32" />
              <div className="mt-6 space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            </div>
          </motion.div>
        ) : metadata ? (
          <motion.section key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300"><BadgeCheck className="h-4 w-4" /> Analysis complete</div>
                  <h2 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{metadata.title}</h2>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2 text-sm text-[var(--text-muted)]">{metadata.fileSize}</div>
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
                <div className="overflow-hidden rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel-bg)]">
                  <img src={metadata.thumbnail} alt={metadata.title} className={`h-48 w-full ${isImageResult ? 'object-contain bg-black/5' : 'object-cover'}`} />
                  <div className="flex items-center justify-between px-4 py-3 text-sm text-[var(--text-muted)]">
                    <span>{metadata.duration}</span>
                    <span>{metadata.author}</span>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--text-secondary)]">Resolution</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{metadata.formats[0]?.quality || 'Best available'}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--text-secondary)]">Available formats</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{metadata.formats.length}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-sm leading-7 text-[var(--text-muted)]">
                    <p><span className="font-medium text-[var(--text-primary)]">Title:</span> {metadata.title}</p>
                    <p><span className="font-medium text-[var(--text-primary)]">Author:</span> {metadata.author}</p>
                    <p><span className="font-medium text-[var(--text-primary)]">Duration:</span> {metadata.duration}</p>
                    <p><span className="font-medium text-[var(--text-primary)]">Estimated size:</span> {metadata.fileSize}</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {metadata.formats.slice(0, 6).map((format, index) => (
                  <div key={`${format.formatId}-${index}`} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)]/90">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{format.quality}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-secondary)]">{format.ext.toUpperCase()} • {format.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleDownload(format)} className="rounded-full border border-[var(--border)] bg-[var(--surface)]/90 p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label={`Download ${format.quality}`}>
                        <Download className="h-4 w-4" />
                      </button>
                      <button className="rounded-full border border-[var(--border)] bg-[var(--surface)]/90 p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Copy link">
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Download actions</h3>
                  <div className="rounded-full border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-1 text-sm text-[var(--text-muted)]">Ready</div>
                </div>
                <div className="mt-5 space-y-3">
                  <button onClick={() => handleDownload(metadata.formats[0])} className="flex w-full items-center justify-center gap-2 rounded-2xl button-primary px-4 py-3 font-semibold transition">
                    <Download className="h-4 w-4" /> Download now
                  </button>
                  {!isImageResult && (
                    <button onClick={handleDownloadAudio} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3 font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">
                      <Download className="h-4 w-4" /> Download audio only
                    </button>
                  )}
                  <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3 font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">
                    <Copy className="h-4 w-4" /> Copy source link
                  </button>
                  <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3 font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">
                    <Share2 className="h-4 w-4" /> Share analysis
                  </button>
                </div>
              </div>
              <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Media intelligence</h3>
                <div className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
                  <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3"><span>Available formats</span><span className="font-medium text-[var(--text-primary)]">{metadata.formats.length}</span></div>
                  <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3"><span>Subtitle availability</span><span className="font-medium text-[var(--text-primary)]">Likely available</span></div>
                  <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3"><span>Estimated file size</span><span className="font-medium text-[var(--text-primary)]">{metadata.fileSize}</span></div>
                </div>
              </div>
              {!isImageResult && (
                <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">Audio-only download</h3>
                      <p className="mt-2 text-sm text-[var(--text-muted)]">Grab a clean audio file directly from the source.</p>
                    </div>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-1 text-sm text-[var(--text-muted)]">Audio</span>
                  </div>
                  <button onClick={handleDownloadAudio} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl button-primary px-4 py-3 font-semibold transition">
                    <Download className="h-4 w-4" /> Download audio only
                  </button>
                </div>
              )}
            </div>
          </motion.section>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <EmptyState icon={PlayCircle} title="Ready for your next media analysis" description="Paste a valid URL to unlock metadata, format options, download actions, and rich insights in seconds." action={<button className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">Try an example link</button>} />
          </motion.div>
        )}
      </AnimatePresence>

      {metadata && !isLoading && (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6 mb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Analyze another link</h3>
              <p className="mt-2 text-sm text-[var(--text-muted)]">Paste a new URL below to run a fresh media analysis.</p>
            </div>
            <button onClick={handleRefresh} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]">
              <RotateCcw className="h-4 w-4" /> Refresh
            </button>
          </div>
          <form onSubmit={handleAnalyze} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://platform.com/video/123" className="h-12 flex-1 border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-blue-500" type="url" required />
            <button type="submit" className="inline-flex items-center justify-center rounded-2xl button-primary px-5 py-3 text-sm font-semibold transition">
              Analyze again
            </button>
          </form>
        </motion.section>
      )}

      {!metadata && !isLoading && (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid gap-4 md:grid-cols-3">
          {quickFacts.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">{card.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[var(--text-muted)]">{card.description}</p>
              </div>
            );
          })}
        </motion.section>
      )}
    </div>
  );
}
