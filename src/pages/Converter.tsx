import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  UploadCloud, FileVideo, Wand2, X, Download, XCircle, Trash2, Loader2,
  CheckCircle2, AlertCircle, Clock3, Film,
} from 'lucide-react';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Button } from '@/src/components/ui/button';
import { useToast } from '@/src/components/ui/toast-provider';
import { useAuth } from '@/src/components/auth/AuthContext';
import { getApiBase } from '@/src/lib/api';

const ACCEPTED_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.m4v'];

type OutputFormat = 'mp4' | 'mkv' | 'mov' | 'avi' | 'webm';
type Quality = 'original' | 'highest' | '1080p' | '720p' | '480p' | '360p';
type VideoCodec = 'h264' | 'h265' | 'av1' | 'vp9';
type AudioCodec = 'aac' | 'mp3' | 'opus' | 'copy';
type AudioMode = 'keep' | 'remove' | 'extract';
type Preset = 'fast' | 'balanced' | 'high-compression';

interface UploadedJob {
  jobId: string;
  originalFilename: string;
  inputFormat: string;
  durationSeconds: number | null;
  resolution: string | null;
  fileSizeBytes: string | null;
}

interface ConversionJob {
  id: string;
  originalFilename: string;
  inputFormat: string;
  outputFormat: string | null;
  fileSizeBytes: string | null;
  durationSeconds: number | null;
  resolution: string | null;
  status: 'QUEUED' | 'CONVERTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  downloadExpiresAt: string | null;
}

const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mkv', label: 'MKV' },
  { value: 'mov', label: 'MOV' },
  { value: 'avi', label: 'AVI' },
  { value: 'webm', label: 'WEBM' },
];

const QUALITIES: { value: Quality; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'highest', label: 'Highest' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
];

const VIDEO_CODECS: { value: VideoCodec; label: string }[] = [
  { value: 'h264', label: 'H.264' },
  { value: 'h265', label: 'H.265' },
  { value: 'av1', label: 'AV1' },
  { value: 'vp9', label: 'VP9' },
];

const AUDIO_CODECS: { value: AudioCodec; label: string }[] = [
  { value: 'aac', label: 'AAC' },
  { value: 'mp3', label: 'MP3' },
  { value: 'opus', label: 'OPUS' },
  { value: 'copy', label: 'Copy' },
];

const AUDIO_MODES: { value: AudioMode; label: string }[] = [
  { value: 'keep', label: 'Keep audio' },
  { value: 'remove', label: 'Remove audio' },
  { value: 'extract', label: 'Extract audio only' },
];

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high-compression', label: 'High compression' },
];

const FPS_OPTIONS = ['keep', '24', '25', '30', '50', '60'];

const STATUS_STYLES: Record<ConversionJob['status'], string> = {
  QUEUED: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  CONVERTING: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
  COMPLETED: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  FAILED: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  CANCELLED: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]',
};

function formatBytes(value: string | null) {
  if (!value) return 'Unknown';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes === 0) return 'Unknown';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return 'Unknown';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatEta(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s remaining` : `${s}s remaining`;
}

function OptionToggle<T extends string>({
  options, value, onChange, disabled,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export default function Converter() {
  const { token } = useAuth();
  const { push } = useToast();
  const apiBase = getApiBase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedJob, setUploadedJob] = useState<UploadedJob | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [outputFormat, setOutputFormat] = useState<OutputFormat>('mp4');
  const [quality, setQuality] = useState<Quality>('original');
  const [videoCodec, setVideoCodec] = useState<VideoCodec>('h264');
  const [audioCodec, setAudioCodec] = useState<AudioCodec>('aac');
  const [audioMode, setAudioMode] = useState<AudioMode>('keep');
  const [preset, setPreset] = useState<Preset>('balanced');
  const [fps, setFps] = useState('keep');

  const [isStarting, setIsStarting] = useState(false);
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);

  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${apiBase}/api/converter/jobs`, { credentials: 'include' });
      const data = await res.json();
      setJobs(Array.isArray(data) ? data : []);
    } catch {
      // Keep the last known list rather than clearing it on a transient network error.
    } finally {
      setJobsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === 'COMPLETED' || activeJob.status === 'FAILED' || activeJob.status === 'CANCELLED') {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/converter/status/${activeJob.id}`, { credentials: 'include' });
        if (!res.ok) return;
        const data: ConversionJob = await res.json();
        setActiveJob(data);
        setLogLines((prev) => {
          const next = [...prev, `${new Date().toLocaleTimeString()} — ${data.status} — ${data.progress}%`];
          return next.slice(-6);
        });
        if (data.status === 'COMPLETED' || data.status === 'FAILED' || data.status === 'CANCELLED') {
          fetchJobs();
          if (data.status === 'COMPLETED') {
            push({ title: 'Conversion complete', description: `${data.originalFilename} is ready to download.` });
          } else if (data.status === 'FAILED') {
            push({ title: 'Conversion failed', description: data.errorMessage || 'The conversion could not be completed.' });
          }
        }
      } catch {
        // Transient network error - the next tick will retry.
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status]);

  const resetForm = () => {
    setUploadedJob(null);
    setUploadError(null);
    setActiveJob(null);
    setLogLines([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async (file: File) => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setUploadError(`Unsupported file type. Allowed: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadedJob(null);
    setActiveJob(null);
    setLogLines([]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiBase}/api/converter/upload`, {
        method: 'POST',
        headers: { ...authHeaders },
        body: formData,
        credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Upload failed. Please try a different file.');
      }
      setUploadedJob({
        jobId: body.id,
        originalFilename: body.originalFilename,
        inputFormat: body.inputFormat,
        durationSeconds: body.durationSeconds,
        resolution: body.resolution,
        fileSizeBytes: body.fileSizeBytes,
      });
      push({ title: 'Upload complete', description: `${body.originalFilename} is ready to configure.` });
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed. Please try a different file.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConvert = async () => {
    if (!uploadedJob) return;
    setIsStarting(true);
    try {
      const res = await fetch(`${apiBase}/api/converter/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        credentials: 'include',
        body: JSON.stringify({
          jobId: uploadedJob.jobId,
          outputFormat,
          quality,
          videoCodec,
          audioCodec,
          audioMode,
          preset,
          fps,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not start the conversion.');
      }
      setActiveJob(body);
      setLogLines([`${new Date().toLocaleTimeString()} — ${body.status} — queued for conversion`]);
      push({ title: 'Conversion started', description: `${uploadedJob.originalFilename} is now converting.` });
      fetchJobs();
    } catch (err: any) {
      push({ title: 'Failed to start conversion', description: err.message || 'Please try again.' });
    } finally {
      setIsStarting(false);
    }
  };

  const handleDownloadJob = async (jobId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/converter/download/${jobId}`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        throw new Error(body?.error || 'The file could not be downloaded.');
      }
      const a = document.createElement('a');
      a.href = body.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      push({ title: 'Download failed', description: err.message || 'Something went wrong.' });
    }
  };

  const handleCancelOrDelete = async (jobId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/converter/${jobId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to remove the job.');
      }
      if (activeJob?.id === jobId) {
        resetForm();
      }
      fetchJobs();
    } catch (err: any) {
      push({ title: 'Action failed', description: err.message || 'Please try again.' });
    }
  };

  const isExtractMode = audioMode === 'extract';

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Video Converter</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Upload a local video, pick a format and quality, and convert it with real-time progress.</p>
        </div>
        <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300">{jobs.length} tracked conversions</div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        {!uploadedJob ? (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleUpload(file);
              }}
              className={`flex flex-col items-center justify-center gap-3 rounded-[1.5rem] border-2 border-dashed p-10 text-center transition ${
                isDraggingOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-[var(--border)]'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
                  <p className="text-sm font-medium text-[var(--text-primary)]">Uploading and validating your video…</p>
                </>
              ) : (
                <>
                  <UploadCloud className="h-10 w-10 text-[var(--text-secondary)]" />
                  <p className="text-sm font-medium text-[var(--text-primary)]">Drag and drop a video file here</p>
                  <p className="text-xs text-[var(--text-muted)]">Supports MP4, MKV, MOV, AVI, WEBM, FLV, M4V</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Browse files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(file);
                    }}
                  />
                </>
              )}
            </div>
            {uploadError && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {uploadError}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]">
                  <FileVideo className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{uploadedJob.originalFilename}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {uploadedJob.inputFormat.toUpperCase()} • {formatDuration(uploadedJob.durationSeconds)} • {uploadedJob.resolution || 'Unknown resolution'} • {formatBytes(uploadedJob.fileSizeBytes)}
                  </p>
                </div>
              </div>
              {!activeJob && (
                <button onClick={resetForm} className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]" aria-label="Remove file">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {!activeJob ? (
              <>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Audio mode</p>
                    <OptionToggle options={AUDIO_MODES} value={audioMode} onChange={setAudioMode} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Audio codec</p>
                    <OptionToggle options={AUDIO_CODECS} value={audioCodec} onChange={setAudioCodec} disabled={audioMode === 'remove'} />
                  </div>

                  {!isExtractMode && (
                    <>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Output format</p>
                        <OptionToggle options={OUTPUT_FORMATS} value={outputFormat} onChange={setOutputFormat} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Quality / resolution</p>
                        <OptionToggle options={QUALITIES} value={quality} onChange={setQuality} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Video codec</p>
                        <OptionToggle options={VIDEO_CODECS} value={videoCodec} onChange={setVideoCodec} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Frame rate</p>
                        <select value={fps} onChange={(e) => setFps(e.target.value)} className="input-field h-10 w-full max-w-[200px] rounded-2xl px-3 text-sm">
                          {FPS_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option === 'keep' ? 'Keep original' : `${option} fps`}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Encode preset</p>
                    <OptionToggle options={PRESETS} value={preset} onChange={setPreset} disabled={isExtractMode} />
                  </div>
                </div>

                {isExtractMode && (
                  <p className="text-xs text-[var(--text-muted)]">Audio will be extracted as a standalone file using the selected audio codec — video/quality options don't apply in this mode.</p>
                )}
                {videoCodec === 'av1' && !isExtractMode && (
                  <p className="flex items-center gap-2 text-xs text-amber-400"><AlertCircle className="h-3.5 w-3.5" /> AV1 encoding is significantly slower than H.264/H.265 on this server — expect a longer wait.</p>
                )}

                <Button type="button" onClick={handleConvert} disabled={isStarting} className="w-full md:w-auto">
                  {isStarting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</> : <><Wand2 className="mr-2 h-4 w-4" /> Convert</>}
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${STATUS_STYLES[activeJob.status]}`}>
                    {activeJob.status === 'CONVERTING' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {activeJob.status === 'COMPLETED' && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {activeJob.status === 'FAILED' && <AlertCircle className="h-3.5 w-3.5" />}
                    {activeJob.status}
                  </span>
                  <span className="text-[var(--text-muted)]">{activeJob.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface)]">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${activeJob.progress}%` }} />
                </div>
                {activeJob.errorMessage && (
                  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{activeJob.errorMessage}</div>
                )}
                {logLines.length > 0 && (
                  <div className="space-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--text-muted)]">
                    {logLines.map((line, index) => <p key={index}>{line}</p>)}
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  {activeJob.status === 'COMPLETED' && (
                    <Button type="button" onClick={() => handleDownloadJob(activeJob.id)}>
                      <Download className="mr-2 h-4 w-4" /> Download
                    </Button>
                  )}
                  {(activeJob.status === 'QUEUED' || activeJob.status === 'CONVERTING') && (
                    <Button type="button" variant="outline" onClick={() => handleCancelOrDelete(activeJob.id)}>
                      <XCircle className="mr-2 h-4 w-4" /> Cancel
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Start a new conversion
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Conversion history</h2>
        <div className="mt-4">
          {jobsLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : jobs.length === 0 ? (
            <EmptyState icon={Film} title="No conversions yet" description="Upload a video above to see it tracked here with live status and download actions." />
          ) : (
            <div className="space-y-3">
              {jobs.map((job, index) => (
                <motion.div key={job.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }} className="flex flex-col gap-3 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)] md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-1 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
                      <FileVideo className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-[var(--text-primary)]">{job.originalFilename}</p>
                        <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${STATUS_STYLES[job.status]}`}>{job.status}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--text-muted)]">
                        <span>{job.inputFormat.toUpperCase()} → {(job.outputFormat || job.inputFormat).toUpperCase()}</span>
                        <span>{formatBytes(job.fileSizeBytes)}</span>
                        {job.status === 'CONVERTING' && <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {job.progress}%</span>}
                        {job.errorMessage && <span className="text-rose-300">{job.errorMessage}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {job.status === 'COMPLETED' && (
                      <button onClick={() => handleDownloadJob(job.id)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Download">
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => handleCancelOrDelete(job.id)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label={job.status === 'QUEUED' || job.status === 'CONVERTING' ? 'Cancel' : 'Delete'}>
                      {job.status === 'QUEUED' || job.status === 'CONVERTING' ? <XCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
