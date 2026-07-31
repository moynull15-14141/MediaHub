import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  UploadCloud, ImageIcon, Wand2, X, Download, Trash2, Loader2,
  AlertCircle, Images, Info, Layers,
} from 'lucide-react';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useToast } from '@/src/components/ui/toast-provider';
import { getApiBase } from '@/src/lib/api';

const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp', '.tiff', '.tif', '.gif', '.heic', '.heif'];

type OutputFormat = 'png' | 'jpeg' | 'webp' | 'avif';
type Fit = 'fill' | 'contain' | 'cover' | 'inside' | 'outside';
type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
type ColorSpace = 'srgb' | 'cmyk' | 'b-w';
type CropPreset = 'free' | '1:1' | '16:9' | '9:16' | '4:5' | '3:2';

interface UploadedImage {
  jobId: string;
  originalFilename: string;
  inputFormat: string;
  width: number | null;
  height: number | null;
  fileSizeBytes: string | null;
  previewUrl: string;
}

interface ImageJob {
  id: string;
  originalFilename: string;
  inputFormat: string;
  outputFormat: string | null;
  fileSizeBytes: string | null;
  width: number | null;
  height: number | null;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadExpiresAt: string | null;
}

interface FullMetadata {
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  format: string | null;
  colorSpace: string | null;
  bitDepth: string | null;
  dpi: number | null;
  hasAlpha: boolean;
  exif: {
    make?: string;
    model?: string;
    dateTimeOriginal?: string;
    modifyDate?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    orientation?: number;
  } | null;
}

const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'avif', label: 'AVIF' },
];

const FITS: { value: Fit; label: string }[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'fill', label: 'Fill' },
  { value: 'inside', label: 'Inside' },
  { value: 'outside', label: 'Outside' },
];

const CROP_PRESETS: { value: CropPreset; label: string; ratio: number | null }[] = [
  { value: 'free', label: 'Free', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
];

const WATERMARK_POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'center', label: 'Center' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const COMPRESSION_PRESETS = [
  { label: 'Maximum quality', quality: 95 },
  { label: 'Balanced', quality: 80 },
  { label: 'Maximum compression', quality: 40 },
];

const THUMBNAIL_SIZES = [128, 256, 512, 1024];

function formatBytes(value: string | number | null) {
  if (value === null) return 'Unknown';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes === 0) return 'Unknown';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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

function BeforeAfterSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.min(100, Math.max(0, percent)));
  };

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full select-none overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
      onMouseDown={(e) => { dragging.current = true; updateFromClientX(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updateFromClientX(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => updateFromClientX(e.touches[0].clientX)}
      onTouchMove={(e) => updateFromClientX(e.touches[0].clientX)}
    >
      <img src={afterUrl} alt="After" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${splitPercent}%` }}>
        <img src={beforeUrl} alt="Before" className="h-full w-full object-contain" style={{ width: containerRef.current?.clientWidth, maxWidth: 'none' }} draggable={false} />
      </div>
      <div className="absolute inset-y-0 w-0.5 bg-blue-400" style={{ left: `${splitPercent}%` }} />
      <div
        className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg"
        style={{ left: `${splitPercent}%` }}
      >
        <Layers className="h-4 w-4" />
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white">Before</span>
      <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white">After</span>
    </div>
  );
}

export default function ImageToolkit() {
  const { push } = useToast();
  const apiBase = getApiBase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [outputFormat, setOutputFormat] = useState<OutputFormat>('jpeg');
  const [quality, setQuality] = useState(80);
  const [progressive, setProgressive] = useState(false);
  const [lossless, setLossless] = useState(false);
  const [preserveMetadata, setPreserveMetadata] = useState(false);
  const [colorSpace, setColorSpace] = useState<ColorSpace | ''>('');

  const [resizeMode, setResizeMode] = useState<'none' | 'dimensions' | 'percent'>('none');
  const [resizeWidth, setResizeWidth] = useState('');
  const [resizeHeight, setResizeHeight] = useState('');
  const [lockAspect, setLockAspect] = useState(true);
  const [resizePercent, setResizePercent] = useState('100');
  const [fit, setFit] = useState<Fit>('cover');

  const [cropPreset, setCropPreset] = useState<CropPreset>('free');
  const [cropX, setCropX] = useState('');
  const [cropY, setCropY] = useState('');
  const [cropWidth, setCropWidth] = useState('');
  const [cropHeight, setCropHeight] = useState('');

  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);

  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkImageFile, setWatermarkImageFile] = useState<File | null>(null);
  const [watermarkOpacity, setWatermarkOpacity] = useState(80);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>('bottom-right');
  const [watermarkScale, setWatermarkScale] = useState(25);
  const [watermarkPadding, setWatermarkPadding] = useState(16);

  const [isProcessing, setIsProcessing] = useState(false);
  const [resultJob, setResultJob] = useState<ImageJob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<FullMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const activeImage = activeIndex !== null ? images[activeIndex] : null;

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${apiBase}/api/image/jobs`, { credentials: 'include' });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) uploadFile(file);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadFile = async (file: File) => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setUploadError(`Unsupported file type. Allowed: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiBase}/api/image/upload`, { method: 'POST', body: formData, credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Upload failed. Please try a different file.');
      const uploaded: UploadedImage = {
        jobId: body.id,
        originalFilename: body.originalFilename,
        inputFormat: body.inputFormat,
        width: body.width,
        height: body.height,
        fileSizeBytes: body.fileSizeBytes,
        previewUrl: URL.createObjectURL(file),
      };
      setImages((prev) => {
        const next = [...prev, uploaded];
        setActiveIndex(next.length - 1);
        return next;
      });
      setResultJob(null);
      setResultUrl(null);
      setMetadata(null);
      push({ title: 'Upload complete', description: `${uploaded.originalFilename} is ready to edit.` });
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed. Please try a different file.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFiles = (fileList: FileList | File[]) => {
    Array.from(fileList).forEach((file) => uploadFile(file));
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (activeIndex === index) {
      setActiveIndex(null);
      setResultJob(null);
      setResultUrl(null);
      setMetadata(null);
    }
  };

  const loadMetadata = async () => {
    if (!activeImage) return;
    setMetadataLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/image/metadata/${activeImage.jobId}`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Failed to load metadata.');
      setMetadata(body);
    } catch (err: any) {
      push({ title: 'Metadata failed', description: err.message || 'Please try again.' });
    } finally {
      setMetadataLoading(false);
    }
  };

  const applyCropPreset = (preset: CropPreset) => {
    setCropPreset(preset);
    if (preset === 'free' || !activeImage?.width || !activeImage?.height) {
      setCropX(''); setCropY(''); setCropWidth(''); setCropHeight('');
      return;
    }
    const ratioEntry = CROP_PRESETS.find((p) => p.value === preset);
    if (!ratioEntry?.ratio) return;
    const { width, height } = activeImage;
    let w = width;
    let h = Math.round(width / ratioEntry.ratio);
    if (h > height) {
      h = height;
      w = Math.round(height * ratioEntry.ratio);
    }
    const x = Math.round((width - w) / 2);
    const y = Math.round((height - h) / 2);
    setCropX(String(x)); setCropY(String(y)); setCropWidth(String(w)); setCropHeight(String(h));
  };

  const runProcess = async (overrides?: Record<string, string>) => {
    if (!activeImage) return;
    setIsProcessing(true);
    setResultJob(null);
    setResultUrl(null);
    try {
      const formData = new FormData();
      formData.append('jobId', activeImage.jobId);
      formData.append('outputFormat', overrides?.outputFormat || outputFormat);
      formData.append('quality', overrides?.quality || String(quality));
      formData.append('progressive', String(progressive));
      formData.append('lossless', String(lossless));
      formData.append('preserveMetadata', String(preserveMetadata));
      if (colorSpace) formData.append('colorSpace', colorSpace);
      if (overrides?.resizeWidth) {
        formData.append('resizeWidth', overrides.resizeWidth);
        formData.append('resizeHeight', overrides.resizeHeight || overrides.resizeWidth);
        formData.append('fit', overrides.fit || 'inside');
      } else {
        if (resizeMode === 'dimensions' && (resizeWidth || resizeHeight)) {
          if (resizeWidth) formData.append('resizeWidth', resizeWidth);
          if (resizeHeight) formData.append('resizeHeight', resizeHeight);
          formData.append('fit', fit);
        } else if (resizeMode === 'percent' && resizePercent) {
          formData.append('resizePercent', resizePercent);
        }
        if (cropWidth && cropHeight && cropX !== '' && cropY !== '') {
          formData.append('cropX', cropX);
          formData.append('cropY', cropY);
          formData.append('cropWidth', cropWidth);
          formData.append('cropHeight', cropHeight);
        }
        if (rotate) formData.append('rotate', String(rotate));
        formData.append('flipHorizontal', String(flipHorizontal));
        formData.append('flipVertical', String(flipVertical));
        if (watermarkText) formData.append('watermarkText', watermarkText);
        if (watermarkImageFile) formData.append('watermarkImage', watermarkImageFile);
        if (watermarkText || watermarkImageFile) {
          formData.append('watermarkOpacity', String(watermarkOpacity / 100));
          formData.append('watermarkPosition', watermarkPosition);
          formData.append('watermarkScale', String(watermarkScale / 100));
          formData.append('watermarkPadding', String(watermarkPadding));
        }
      }

      const res = await fetch(`${apiBase}/api/image/process`, { method: 'POST', body: formData, credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Processing failed.');
      setResultJob(body);

      const urlRes = await fetch(`${apiBase}/api/image/download/${body.id}`, { credentials: 'include' });
      const urlBody = await urlRes.json().catch(() => null);
      if (urlRes.ok && urlBody?.url) setResultUrl(urlBody.url);

      push({ title: 'Processing complete', description: `${activeImage.originalFilename} is ready to download.` });
      fetchJobs();
    } catch (err: any) {
      push({ title: 'Processing failed', description: err.message || 'Please try again.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async (jobId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/image/download/${jobId}`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) throw new Error(body?.error || 'The file could not be downloaded.');
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

  const handleDeleteJob = async (jobId: string) => {
    try {
      await fetch(`${apiBase}/api/image/${jobId}`, { method: 'DELETE', credentials: 'include' });
      fetchJobs();
    } catch {
      push({ title: 'Action failed', description: 'Could not remove this job.' });
    }
  };

  const savedPercent = useMemo(() => {
    if (!activeImage?.fileSizeBytes || !resultJob?.fileSizeBytes) return null;
    const original = Number(activeImage.fileSizeBytes);
    const compressed = Number(resultJob.fileSizeBytes);
    if (!original) return null;
    return Math.round((1 - compressed / original) * 100);
  }, [activeImage, resultJob]);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Image Toolkit</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Convert, compress, resize, crop, rotate, and watermark images with instant before/after preview.</p>
        </div>
        <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300">{jobs.length} tracked jobs</div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-3 rounded-[1.5rem] border-2 border-dashed p-8 text-center transition ${
            isDraggingOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-[var(--border)]'
          }`}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
              <p className="text-sm font-medium text-[var(--text-primary)]">Uploading and validating…</p>
            </>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-[var(--text-secondary)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">Drag & drop, paste, or browse images</p>
              <p className="text-xs text-[var(--text-muted)]">PNG, JPG, WEBP, AVIF, BMP, TIFF, GIF, HEIC — multiple files supported</p>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>Browse files</Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
              />
            </>
          )}
        </div>
        {uploadError && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {uploadError}
          </div>
        )}

        {images.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {images.map((img, index) => (
              <button
                key={img.jobId}
                onClick={() => { setActiveIndex(index); setResultJob(null); setResultUrl(null); setMetadata(null); }}
                className={`relative flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-medium transition ${
                  activeIndex === index ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
                }`}
              >
                <img src={img.previewUrl} className="h-8 w-8 rounded-lg object-cover" alt="" />
                <span className="max-w-[120px] truncate">{img.originalFilename}</span>
                <span onClick={(e) => { e.stopPropagation(); removeImage(index); }} className="ml-1 rounded-full p-0.5 hover:bg-black/20">
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {!activeImage ? (
        <EmptyState icon={ImageIcon} title="No image selected" description="Upload an image above to start converting, compressing, resizing, cropping, or watermarking it." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
            <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{activeImage.originalFilename}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {activeImage.inputFormat.toUpperCase()} • {activeImage.width}×{activeImage.height} • {formatBytes(activeImage.fileSizeBytes)}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={loadMetadata} disabled={metadataLoading}>
                {metadataLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Info className="mr-2 h-3.5 w-3.5" />} Metadata
              </Button>
            </div>

            {metadata && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-secondary)]">
                <div>Dimensions: <span className="text-[var(--text-primary)]">{metadata.width}×{metadata.height}</span></div>
                <div>Size: <span className="text-[var(--text-primary)]">{formatBytes(metadata.fileSizeBytes)}</span></div>
                <div>Format: <span className="text-[var(--text-primary)]">{metadata.format}</span></div>
                <div>Bit depth: <span className="text-[var(--text-primary)]">{metadata.bitDepth || 'Unknown'}</span></div>
                <div>Color space: <span className="text-[var(--text-primary)]">{metadata.colorSpace || 'Unknown'}</span></div>
                <div>DPI: <span className="text-[var(--text-primary)]">{metadata.dpi || 'Unknown'}</span></div>
                <div>Alpha: <span className="text-[var(--text-primary)]">{metadata.hasAlpha ? 'Yes' : 'No'}</span></div>
                {metadata.exif?.make && <div>Camera: <span className="text-[var(--text-primary)]">{metadata.exif.make} {metadata.exif.model}</span></div>}
                {metadata.exif?.dateTimeOriginal && <div>Created: <span className="text-[var(--text-primary)]">{new Date(metadata.exif.dateTimeOriginal).toLocaleString()}</span></div>}
                {metadata.exif?.gpsLatitude && <div className="col-span-2">GPS: <span className="text-[var(--text-primary)]">{metadata.exif.gpsLatitude.toFixed(5)}, {metadata.exif.gpsLongitude?.toFixed(5)}</span></div>}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Output format</p>
              <OptionToggle options={OUTPUT_FORMATS} value={outputFormat} onChange={setOutputFormat} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Compression / quality</p>
                <span className="text-xs text-[var(--text-muted)]">{quality}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {COMPRESSION_PRESETS.map((p) => (
                  <Button key={p.label} type="button" size="sm" variant={quality === p.quality ? 'default' : 'outline'} onClick={() => setQuality(p.quality)}>{p.label}</Button>
                ))}
              </div>
              <input type="range" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-blue-500" />
              <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={progressive} onChange={(e) => setProgressive(e.target.checked)} /> Progressive JPEG</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} /> Lossless WEBP</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={preserveMetadata} onChange={(e) => setPreserveMetadata(e.target.checked)} /> Preserve metadata</label>
              </div>
              <select value={colorSpace} onChange={(e) => setColorSpace(e.target.value as ColorSpace | '')} className="input-field h-10 w-full max-w-[220px] rounded-2xl px-3 text-sm">
                <option value="">Color space: original</option>
                <option value="srgb">sRGB</option>
                <option value="cmyk">CMYK</option>
                <option value="b-w">Black & white</option>
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Resize</p>
              <OptionToggle options={[{ value: 'none', label: 'Off' }, { value: 'dimensions', label: 'Width/Height' }, { value: 'percent', label: 'Percentage' }]} value={resizeMode} onChange={setResizeMode as any} />
              {resizeMode === 'dimensions' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="number" placeholder="Width" value={resizeWidth} onChange={(e) => {
                    const v = e.target.value;
                    setResizeWidth(v);
                    if (lockAspect && activeImage.width && activeImage.height && v) {
                      setResizeHeight(String(Math.round((Number(v) / activeImage.width) * activeImage.height)));
                    }
                  }} className="h-10 w-28" />
                  <span className="text-xs text-[var(--text-muted)]">×</span>
                  <Input type="number" placeholder="Height" value={resizeHeight} onChange={(e) => {
                    const v = e.target.value;
                    setResizeHeight(v);
                    if (lockAspect && activeImage.width && activeImage.height && v) {
                      setResizeWidth(String(Math.round((Number(v) / activeImage.height) * activeImage.width)));
                    }
                  }} className="h-10 w-28" />
                  <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]"><input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} /> Lock aspect</label>
                  <select value={fit} onChange={(e) => setFit(e.target.value as Fit)} className="input-field h-10 rounded-2xl px-3 text-sm">
                    {FITS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              )}
              {resizeMode === 'percent' && (
                <Input type="number" placeholder="e.g. 50" value={resizePercent} onChange={(e) => setResizePercent(e.target.value)} className="h-10 w-32" />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Crop</p>
              <OptionToggle options={CROP_PRESETS.map(({ value, label }) => ({ value, label }))} value={cropPreset} onChange={applyCropPreset} />
              {cropPreset === 'free' && (
                <div className="flex flex-wrap gap-2">
                  <Input type="number" placeholder="X" value={cropX} onChange={(e) => setCropX(e.target.value)} className="h-10 w-24" />
                  <Input type="number" placeholder="Y" value={cropY} onChange={(e) => setCropY(e.target.value)} className="h-10 w-24" />
                  <Input type="number" placeholder="Width" value={cropWidth} onChange={(e) => setCropWidth(e.target.value)} className="h-10 w-24" />
                  <Input type="number" placeholder="Height" value={cropHeight} onChange={(e) => setCropHeight(e.target.value)} className="h-10 w-24" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Rotate / Flip</p>
              <div className="flex flex-wrap gap-2">
                <OptionToggle options={[{ value: '0', label: '0°' }, { value: '90', label: '90°' }, { value: '180', label: '180°' }, { value: '270', label: '270°' }]} value={String(rotate)} onChange={(v) => setRotate(Number(v) as 0 | 90 | 180 | 270)} />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={flipHorizontal} onChange={(e) => setFlipHorizontal(e.target.checked)} /> Flip horizontal</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={flipVertical} onChange={(e) => setFlipVertical(e.target.checked)} /> Flip vertical</label>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Watermark</p>
              <Input placeholder="Watermark text (optional)" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} className="h-10" />
              <input type="file" accept="image/*" onChange={(e) => setWatermarkImageFile(e.target.files?.[0] || null)} className="text-xs text-[var(--text-secondary)]" />
              {(watermarkText || watermarkImageFile) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)]">Opacity {watermarkOpacity}%</p>
                    <input type="range" min={10} max={100} value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(Number(e.target.value))} className="w-full accent-blue-500" />
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)]">Scale {watermarkScale}%</p>
                    <input type="range" min={5} max={80} value={watermarkScale} onChange={(e) => setWatermarkScale(Number(e.target.value))} className="w-full accent-blue-500" />
                  </div>
                  <select value={watermarkPosition} onChange={(e) => setWatermarkPosition(e.target.value as WatermarkPosition)} className="input-field h-10 rounded-2xl px-3 text-sm">
                    {WATERMARK_POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <Input type="number" placeholder="Padding (px)" value={watermarkPadding} onChange={(e) => setWatermarkPadding(Number(e.target.value))} className="h-10" />
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-[var(--border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Thumbnail generator</p>
              <div className="flex flex-wrap gap-2">
                {THUMBNAIL_SIZES.map((size) => (
                  <Button key={size} type="button" size="sm" variant="outline" disabled={isProcessing} onClick={() => runProcess({ outputFormat: 'jpeg', quality: '85', resizeWidth: String(size) })}>
                    {size}px
                  </Button>
                ))}
              </div>
            </div>

            <Button type="button" onClick={() => runProcess()} disabled={isProcessing} className="w-full">
              {isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</> : <><Wand2 className="mr-2 h-4 w-4" /> Apply & Process</>}
            </Button>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4 rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Before / After preview</h2>
            {resultUrl ? (
              <>
                <BeforeAfterSlider beforeUrl={activeImage.previewUrl} afterUrl={resultUrl} />
                <div className="grid grid-cols-2 gap-3 text-xs text-[var(--text-secondary)]">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Original</p>
                    <p className="text-sm text-[var(--text-primary)]">{formatBytes(activeImage.fileSizeBytes)}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Processed</p>
                    <p className="text-sm text-[var(--text-primary)]">{formatBytes(resultJob?.fileSizeBytes ?? null)} {savedPercent !== null && <span className={savedPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>({savedPercent >= 0 ? '-' : '+'}{Math.abs(savedPercent)}%)</span>}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" onClick={() => resultJob && handleDownload(resultJob.id)}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                  <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(JSON.stringify(resultJob, null, 2))}>
                    Copy file info
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)]">
                <img src={activeImage.previewUrl} alt="Preview" className="max-h-full max-w-full rounded-xl object-contain" />
              </div>
            )}
            {resultJob?.status === 'FAILED' && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{resultJob.errorMessage}</div>
            )}
          </motion.div>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Processing history</h2>
        <div className="mt-4">
          {jobsLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : jobs.length === 0 ? (
            <EmptyState icon={Images} title="No processed images yet" description="Images you process above will appear here with quick download and delete actions." />
          ) : (
            <div className="space-y-3">
              {jobs.map((job, index) => (
                <motion.div key={job.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }} className="flex flex-col gap-3 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)] md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{job.originalFilename}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {job.inputFormat.toUpperCase()} → {(job.outputFormat || job.inputFormat).toUpperCase()} • {formatBytes(job.fileSizeBytes)} • {job.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {job.status === 'COMPLETED' && (
                      <Button type="button" size="sm" variant="outline" onClick={() => handleDownload(job.id)}><Download className="h-3.5 w-3.5" /></Button>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteJob(job.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
