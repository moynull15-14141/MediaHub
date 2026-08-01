import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  UploadCloud, ImageIcon, Wand2, X, Download, Trash2, Loader2,
  AlertCircle, Images, Info, Layers, Crop, RotateCw, SlidersHorizontal,
  Type, Maximize2, Plus, ZoomIn, ZoomOut, Scan,
} from 'lucide-react';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useToast } from '@/src/components/ui/toast-provider';
import { getApiBase } from '@/src/lib/api';

const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp', '.tiff', '.tif', '.gif', '.heic', '.heif'];

const IMAGE_SESSION_KEY = 'mediahub-imagetoolkit-active-images';

type OutputFormat = 'png' | 'jpeg' | 'webp' | 'avif';
type Fit = 'fill' | 'contain' | 'cover' | 'inside' | 'outside';
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

const WATERMARK_QUICK_POSITIONS: { label: string; x: number; y: number }[] = [
  { label: 'Top left', x: 12, y: 8 },
  { label: 'Top right', x: 88, y: 8 },
  { label: 'Center', x: 50, y: 50 },
  { label: 'Bottom left', x: 12, y: 92 },
  { label: 'Bottom right', x: 88, y: 92 },
];

// Must match server/services/image-processing.service.ts WATERMARK_FONTS -
// these are the only fonts actually installed in the container, so every
// option here is guaranteed to render as a genuinely different typeface.
const WATERMARK_FONTS = [
  { value: 'DejaVu Sans', label: 'DejaVu Sans' },
  { value: 'DejaVu Serif', label: 'DejaVu Serif' },
  { value: 'Liberation Sans', label: 'Liberation Sans' },
  { value: 'Liberation Serif', label: 'Liberation Serif' },
  { value: 'Liberation Mono', label: 'Liberation Mono' },
  { value: 'Noto Sans', label: 'Noto Sans' },
  { value: 'Carlito', label: 'Carlito (Calibri-like)' },
  { value: 'Caladea', label: 'Caladea (Cambria-like)' },
];

const COMPRESSION_PRESETS = [
  { label: 'Maximum quality', quality: 95 },
  { label: 'Balanced', quality: 80 },
  { label: 'Maximum compression', quality: 40 },
];

const THUMBNAIL_SIZES = [128, 256, 512, 1024];

type ToolId = 'convert' | 'resize' | 'crop' | 'transform' | 'color' | 'watermark' | 'thumbnail' | 'metadata';

const TOOLS: { id: ToolId; label: string; icon: typeof Wand2 }[] = [
  { id: 'convert', label: 'Convert & Compress', icon: Wand2 },
  { id: 'resize', label: 'Resize', icon: Maximize2 },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'transform', label: 'Rotate & Flip', icon: RotateCw },
  { id: 'color', label: 'Color', icon: SlidersHorizontal },
  { id: 'watermark', label: 'Watermark', icon: Type },
  { id: 'thumbnail', label: 'Thumbnail', icon: Images },
  { id: 'metadata', label: 'Metadata', icon: Info },
];

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.18) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.18) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

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

interface CropRectPx { x: number; y: number; w: number; h: number }
type CropDragType = 'move' | 'new' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const clampCropRect = (r: CropRectPx, maxW: number, maxH: number): CropRectPx => {
  const w = Math.min(Math.max(8, r.w), maxW);
  const h = Math.min(Math.max(8, r.h), maxH);
  const x = Math.min(Math.max(0, r.x), maxW - w);
  const y = Math.min(Math.max(0, r.y), maxH - h);
  return { x, y, w, h };
};

const CROP_HANDLES: { type: CropDragType; style: React.CSSProperties; cursor: string }[] = [
  { type: 'nw', style: { left: 0, top: 0, transform: 'translate(-50%,-50%)' }, cursor: 'nwse-resize' },
  { type: 'n', style: { left: '50%', top: 0, transform: 'translate(-50%,-50%)' }, cursor: 'ns-resize' },
  { type: 'ne', style: { right: 0, top: 0, transform: 'translate(50%,-50%)' }, cursor: 'nesw-resize' },
  { type: 'e', style: { right: 0, top: '50%', transform: 'translate(50%,-50%)' }, cursor: 'ew-resize' },
  { type: 'se', style: { right: 0, bottom: 0, transform: 'translate(50%,50%)' }, cursor: 'nwse-resize' },
  { type: 's', style: { left: '50%', bottom: 0, transform: 'translate(-50%,50%)' }, cursor: 'ns-resize' },
  { type: 'sw', style: { left: 0, bottom: 0, transform: 'translate(-50%,50%)' }, cursor: 'nesw-resize' },
  { type: 'w', style: { left: 0, top: '50%', transform: 'translate(-50%,-50%)' }, cursor: 'ew-resize' },
];

// A Photoshop-style draggable/resizable crop marquee. Coordinates are all in
// "natural" image pixels (what the backend crop expects); the mapping to/from
// on-screen pixels only needs a single scale factor because the container is
// sized to exactly match the source image's aspect ratio (no letterboxing).
function CropOverlay({
  containerRef, naturalWidth, naturalHeight, rect, onChange, aspectRatio,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  naturalWidth: number;
  naturalHeight: number;
  rect: CropRectPx | null;
  onChange: (rect: CropRectPx) => void;
  aspectRatio: number | null;
}) {
  const dragRef = useRef<{
    type: CropDragType;
    anchorX: number;
    anchorY: number;
    startRect: CropRectPx;
    startClientX: number;
    startClientY: number;
  } | null>(null);

  const toNatural = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const scale = naturalWidth / r.width;
    return { x: (clientX - r.left) * scale, y: (clientY - r.top) * scale };
  };

  const handleMove = (e: MouseEvent) => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag || !el) return;
    const scale = naturalWidth / el.getBoundingClientRect().width;
    const dx = (e.clientX - drag.startClientX) * scale;
    const dy = (e.clientY - drag.startClientY) * scale;

    let next: CropRectPx;

    if (drag.type === 'move') {
      next = { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy };
    } else if (drag.type === 'new') {
      let w = dx;
      let h = dy;
      if (aspectRatio) {
        if (Math.abs(w) > Math.abs(h) * aspectRatio) {
          h = (h < 0 ? -1 : 1) * Math.abs(w) / aspectRatio;
        } else {
          w = (w < 0 ? -1 : 1) * Math.abs(h) * aspectRatio;
        }
      }
      next = {
        x: w < 0 ? drag.anchorX + w : drag.anchorX,
        y: h < 0 ? drag.anchorY + h : drag.anchorY,
        w: Math.abs(w),
        h: Math.abs(h),
      };
    } else {
      let { x, y, w, h } = drag.startRect;
      const hasN = drag.type.includes('n');
      const hasS = drag.type.includes('s');
      const hasE = drag.type.includes('e');
      const hasW = drag.type.includes('w');
      if (hasE) w = drag.startRect.w + dx;
      if (hasW) { w = drag.startRect.w - dx; x = drag.startRect.x + dx; }
      if (hasS) h = drag.startRect.h + dy;
      if (hasN) { h = drag.startRect.h - dy; y = drag.startRect.y + dy; }

      if (aspectRatio) {
        const horizontal = hasE || hasW;
        const vertical = hasN || hasS;
        if (horizontal && vertical) {
          h = w / aspectRatio;
          if (hasN) y = drag.startRect.y + drag.startRect.h - h;
        } else if (horizontal) {
          h = w / aspectRatio;
          y = drag.startRect.y + (drag.startRect.h - h) / 2;
        } else {
          w = h * aspectRatio;
          x = drag.startRect.x + (drag.startRect.w - w) / 2;
        }
      }
      next = { x, y, w, h };
    }

    onChange(clampCropRect(next, naturalWidth, naturalHeight));
  };

  const handleUp = () => {
    dragRef.current = null;
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
  };

  const startDrag = (type: CropDragType, e: React.MouseEvent, anchor?: { x: number; y: number }) => {
    e.preventDefault();
    e.stopPropagation();
    const startRect = rect || { x: 0, y: 0, w: 0, h: 0 };
    dragRef.current = {
      type,
      anchorX: anchor?.x ?? startRect.x,
      anchorY: anchor?.y ?? startRect.y,
      startRect,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  if (!rect) {
    return (
      <div
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={(e) => startDrag('new', e, toNatural(e.clientX, e.clientY))}
      />
    );
  }

  const pct = {
    left: (rect.x / naturalWidth) * 100,
    top: (rect.y / naturalHeight) * 100,
    width: (rect.w / naturalWidth) * 100,
    height: (rect.h / naturalHeight) * 100,
  };

  return (
    <div
      className="absolute cursor-move border-2 border-blue-400"
      style={{ left: `${pct.left}%`, top: `${pct.top}%`, width: `${pct.width}%`, height: `${pct.height}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => startDrag('move', e)}
    >
      {CROP_HANDLES.map((h) => (
        <div
          key={h.type}
          onMouseDown={(e) => startDrag(h.type, e)}
          className="absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-500 shadow"
          style={{ ...h.style, cursor: h.cursor }}
        />
      ))}
    </div>
  );
}

export default function ImageToolkit() {
  const { push } = useToast();
  const apiBase = getApiBase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkFileInputRef = useRef<HTMLInputElement>(null);
  const canvasImageRef = useRef<HTMLDivElement>(null);

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
  const [lockAspect, setLockAspect] = useState(false);
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
  const [watermarkScale, setWatermarkScale] = useState(25);
  const [watermarkXPercent, setWatermarkXPercent] = useState(85);
  const [watermarkYPercent, setWatermarkYPercent] = useState(85);
  const [watermarkFontFamily, setWatermarkFontFamily] = useState(WATERMARK_FONTS[0].value);
  const [watermarkColor, setWatermarkColor] = useState('#ffffff');
  const [watermarkBold, setWatermarkBold] = useState(false);

  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [hue, setHue] = useState(0);

  const [isProcessing, setIsProcessing] = useState(false);
  const [resultJob, setResultJob] = useState<ImageJob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<FullMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const [activeTool, setActiveTool] = useState<ToolId>('convert');
  const [zoom, setZoom] = useState(1);

  const activeImage = activeIndex !== null ? images[activeIndex] : null;

  // Live preview: color/rotate/flip are cheap enough to approximate with CSS
  // in the browser, so the canvas updates instantly as sliders move instead
  // of waiting on a server round-trip. The server-side Sharp pipeline is
  // still the source of truth once "Apply & Process" actually runs.
  const previewFilter = useMemo(() => {
    const parts: string[] = [];
    if (brightness) parts.push(`brightness(${1 + brightness / 100})`);
    if (contrast) parts.push(`contrast(${1 + contrast / 100})`);
    if (saturation) parts.push(`saturate(${1 + saturation / 100})`);
    if (hue) parts.push(`hue-rotate(${hue}deg)`);
    return parts.join(' ') || 'none';
  }, [brightness, contrast, saturation, hue]);

  const previewTransform = useMemo(() => {
    const parts: string[] = [];
    if (rotate) parts.push(`rotate(${rotate}deg)`);
    if (flipHorizontal) parts.push('scaleX(-1)');
    if (flipVertical) parts.push('scaleY(-1)');
    return parts.join(' ') || 'none';
  }, [rotate, flipHorizontal, flipVertical]);

  const [watermarkPreviewUrl, setWatermarkPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!watermarkImageFile) {
      setWatermarkPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(watermarkImageFile);
    setWatermarkPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [watermarkImageFile]);

  // Any edit invalidates the last processed result, so the canvas falls back
  // to the live client-side preview until "Apply & Process" runs again.
  const skipNextInvalidate = useRef(true);
  useEffect(() => {
    if (skipNextInvalidate.current) {
      skipNextInvalidate.current = false;
      return;
    }
    setResultJob(null);
    setResultUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    outputFormat, quality, progressive, lossless, preserveMetadata, colorSpace,
    resizeMode, resizeWidth, resizeHeight, resizePercent, fit,
    cropPreset, cropX, cropY, cropWidth, cropHeight,
    rotate, flipHorizontal, flipVertical,
    watermarkText, watermarkImageFile, watermarkOpacity, watermarkScale,
    watermarkXPercent, watermarkYPercent, watermarkFontFamily, watermarkColor, watermarkBold,
    brightness, contrast, saturation, hue,
    activeIndex,
  ]);

  // Positioned by its center point (watermarkXPercent/YPercent), matching the
  // server's placement math exactly so the live preview lines up with the
  // real output. Dragging (see startWatermarkDrag) just moves this point.
  const watermarkOverlayStyle = useMemo((): React.CSSProperties => {
    if (!activeImage?.width) return { display: 'none' };
    return {
      position: 'absolute',
      left: `${watermarkXPercent}%`,
      top: `${watermarkYPercent}%`,
      transform: 'translate(-50%, -50%)',
      width: `${watermarkScale}%`,
      opacity: watermarkOpacity / 100,
      cursor: 'move',
    };
  }, [activeImage, watermarkScale, watermarkOpacity, watermarkXPercent, watermarkYPercent]);

  const startWatermarkDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = canvasImageRef.current;
    if (!container) return;
    const updateFromClient = (clientX: number, clientY: number) => {
      const r = container.getBoundingClientRect();
      const x = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
      const y = Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100));
      setWatermarkXPercent(Math.round(x));
      setWatermarkYPercent(Math.round(y));
    };
    updateFromClient(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => updateFromClient(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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

  // Restore whatever images were uploaded if this page was unmounted (e.g.
  // the user switched to another module) and comes back later - the files
  // stay on the server, only the local view (and its blob preview URLs,
  // which don't survive a remount) was lost.
  const hasRestoredImagesRef = useRef(false);
  useEffect(() => {
    const raw = localStorage.getItem(IMAGE_SESSION_KEY);
    if (!raw) {
      hasRestoredImagesRef.current = true;
      return;
    }
    let stored: { jobIds: string[]; activeIndex: number | null };
    try {
      stored = JSON.parse(raw);
    } catch {
      localStorage.removeItem(IMAGE_SESSION_KEY);
      hasRestoredImagesRef.current = true;
      return;
    }
    if (!Array.isArray(stored.jobIds) || stored.jobIds.length === 0) {
      hasRestoredImagesRef.current = true;
      return;
    }
    (async () => {
      const restored: UploadedImage[] = [];
      for (const jobId of stored.jobIds) {
        try {
          const res = await fetch(`${apiBase}/api/image/status/${jobId}`, { credentials: 'include' });
          if (!res.ok) continue;
          const data = await res.json();
          restored.push({
            jobId: data.id,
            originalFilename: data.originalFilename,
            inputFormat: data.inputFormat,
            width: data.width,
            height: data.height,
            fileSizeBytes: data.fileSizeBytes,
            previewUrl: data.previewUrl,
          });
        } catch {
          // Skip images that no longer exist server-side (expired/deleted).
        }
      }
      if (restored.length > 0) {
        setImages(restored);
        const idx = stored.activeIndex;
        setActiveIndex(idx !== null && idx >= 0 && idx < restored.length ? idx : 0);
      } else {
        localStorage.removeItem(IMAGE_SESSION_KEY);
      }
      hasRestoredImagesRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasRestoredImagesRef.current) return;
    if (images.length === 0) {
      localStorage.removeItem(IMAGE_SESSION_KEY);
      return;
    }
    try {
      localStorage.setItem(IMAGE_SESSION_KEY, JSON.stringify({ jobIds: images.map((img) => img.jobId), activeIndex }));
    } catch {
      // Storage unavailable - not fatal, just skip persistence.
    }
  }, [images, activeIndex]);

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

  // Editing options are per-image: carrying over a crop/watermark/resize set
  // up for one image onto the next (different dimensions, different intent)
  // is a common source of "the output looks wrong" confusion, so every
  // option resets whenever the active image changes.
  const resetEditOptions = () => {
    setOutputFormat('jpeg');
    setQuality(80);
    setProgressive(false);
    setLossless(false);
    setPreserveMetadata(false);
    setColorSpace('');
    setResizeMode('none');
    setResizeWidth('');
    setResizeHeight('');
    setResizePercent('100');
    setFit('cover');
    setCropPreset('free');
    setCropX(''); setCropY(''); setCropWidth(''); setCropHeight('');
    setRotate(0);
    setFlipHorizontal(false);
    setFlipVertical(false);
    setWatermarkText('');
    setWatermarkImageFile(null);
    if (watermarkFileInputRef.current) watermarkFileInputRef.current.value = '';
    setWatermarkOpacity(80);
    setWatermarkScale(25);
    setWatermarkXPercent(85);
    setWatermarkYPercent(85);
    setWatermarkFontFamily(WATERMARK_FONTS[0].value);
    setWatermarkColor('#ffffff');
    setWatermarkBold(false);
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setHue(0);
    setResultJob(null);
    setResultUrl(null);
    setMetadata(null);
    setZoom(1);
  };

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
      resetEditOptions();
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

  const cropRectPx: CropRectPx | null =
    cropX !== '' && cropY !== '' && cropWidth !== '' && cropHeight !== ''
      ? { x: Number(cropX), y: Number(cropY), w: Number(cropWidth), h: Number(cropHeight) }
      : null;

  const handleCropRectChange = (r: CropRectPx) => {
    setCropX(String(Math.round(r.x)));
    setCropY(String(Math.round(r.y)));
    setCropWidth(String(Math.round(r.w)));
    setCropHeight(String(Math.round(r.h)));
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
        if (watermarkText) {
          formData.append('watermarkText', watermarkText);
          formData.append('watermarkFontFamily', watermarkFontFamily);
          formData.append('watermarkColor', watermarkColor);
          formData.append('watermarkBold', String(watermarkBold));
        }
        if (watermarkImageFile) formData.append('watermarkImage', watermarkImageFile);
        if (watermarkText || watermarkImageFile) {
          formData.append('watermarkOpacity', String(watermarkOpacity / 100));
          formData.append('watermarkScale', String(watermarkScale / 100));
          formData.append('watermarkXPercent', String(watermarkXPercent));
          formData.append('watermarkYPercent', String(watermarkYPercent));
        }
        if (brightness) formData.append('brightness', String(brightness));
        if (contrast) formData.append('contrast', String(contrast));
        if (saturation) formData.append('saturation', String(saturation));
        if (hue) formData.append('hue', String(hue));
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

      {!activeImage ? (
        <>
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
          </motion.div>
          <EmptyState icon={ImageIcon} title="No image selected" description="Upload an image above to start converting, compressing, resizing, cropping, or watermarking it." />
        </>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex h-[75vh] min-h-[560px] overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-card)]">
          {/* Tool rail */}
          <div className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--surface)] py-4">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                title={tool.label}
                onClick={() => setActiveTool(tool.id)}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl transition ${
                  activeTool === tool.id ? 'bg-blue-500/15 text-blue-300 shadow-[0_10px_30px_rgba(59,130,246,0.18)]' : 'text-[var(--text-secondary)] hover:bg-[var(--panel-bg)] hover:text-[var(--text-primary)]'
                }`}
              >
                <tool.icon className="h-5 w-5" />
              </button>
            ))}
            <div className="mt-auto">
              <button type="button" title="Add another image" onClick={() => fileInputRef.current?.click()} className="flex h-11 w-11 items-center justify-center rounded-2xl text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)] hover:text-[var(--text-primary)]">
                <Plus className="h-5 w-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
              />
            </div>
          </div>

          {/* Canvas */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{activeImage.originalFilename}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {activeImage.inputFormat.toUpperCase()} • {activeImage.width}×{activeImage.height} • {formatBytes(activeImage.fileSizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="rounded-xl p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]"><ZoomOut className="h-4 w-4" /></button>
                <span className="w-12 text-center text-xs text-[var(--text-secondary)]">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="rounded-xl p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]"><ZoomIn className="h-4 w-4" /></button>
                <button type="button" title="Reset zoom" onClick={() => setZoom(1)} className="ml-1 rounded-xl p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]"><Scan className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="relative flex flex-1 items-center justify-center overflow-auto p-6" style={CHECKERBOARD_STYLE}>
              {resultUrl ? (
                <div style={{ width: `${Math.max(zoom, 0.5) * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none' }}>
                  <BeforeAfterSlider beforeUrl={activeImage.previewUrl} afterUrl={resultUrl} />
                </div>
              ) : (
                <div
                  ref={canvasImageRef}
                  className="relative max-w-none"
                  style={{
                    width: `${zoom * 100}%`,
                    aspectRatio: activeImage.width && activeImage.height ? `${activeImage.width} / ${activeImage.height}` : undefined,
                  }}
                >
                  <img
                    src={activeImage.previewUrl}
                    alt="Preview"
                    className="h-full w-full rounded-xl object-contain shadow-2xl"
                    style={{ filter: previewFilter, transform: previewTransform }}
                  />
                  {activeTool === 'crop' && activeImage.width && activeImage.height ? (
                    <CropOverlay
                      containerRef={canvasImageRef}
                      naturalWidth={activeImage.width}
                      naturalHeight={activeImage.height}
                      rect={cropRectPx}
                      onChange={handleCropRectChange}
                      aspectRatio={CROP_PRESETS.find((p) => p.value === cropPreset)?.ratio ?? null}
                    />
                  ) : (
                    cropWidth && cropHeight && cropX !== '' && cropY !== '' && activeImage.width && activeImage.height && (
                      <div
                        className="pointer-events-none absolute border-2 border-blue-400"
                        style={{
                          left: `${(Number(cropX) / activeImage.width) * 100}%`,
                          top: `${(Number(cropY) / activeImage.height) * 100}%`,
                          width: `${(Number(cropWidth) / activeImage.width) * 100}%`,
                          height: `${(Number(cropHeight) / activeImage.height) * 100}%`,
                          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                        }}
                      />
                    )
                  )}
                  {watermarkText && !watermarkImageFile && (
                    <span
                      onMouseDown={startWatermarkDrag}
                      style={{
                        ...watermarkOverlayStyle,
                        color: watermarkColor,
                        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                        fontFamily: watermarkFontFamily,
                        fontWeight: watermarkBold ? 700 : 400,
                        fontSize: `${Math.max(10, (watermarkScale / 100) * (activeImage.width || 0) * 0.12)}px`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {watermarkText}
                    </span>
                  )}
                  {watermarkImageFile && watermarkPreviewUrl && (
                    <img src={watermarkPreviewUrl} alt="" onMouseDown={startWatermarkDrag} style={watermarkOverlayStyle} draggable={false} />
                  )}
                </div>
              )}
            </div>

            {resultJob?.status === 'FAILED' && (
              <div className="mx-4 mb-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{resultJob.errorMessage}</div>
            )}

            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-t border-[var(--border)] p-3">
                {images.map((img, index) => (
                  <button
                    key={img.jobId}
                    type="button"
                    onClick={() => { setActiveIndex(index); resetEditOptions(); }}
                    className={`group relative shrink-0 rounded-xl border-2 transition ${activeIndex === index ? 'border-blue-500' : 'border-transparent hover:border-[var(--border-strong)]'}`}
                  >
                    <img src={img.previewUrl} className="h-14 w-14 rounded-lg object-cover" alt="" />
                    <span onClick={(e) => { e.stopPropagation(); removeImage(index); }} className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white group-hover:flex">
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Settings panel */}
          <div className="flex w-80 shrink-0 flex-col border-l border-[var(--border)]">
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                {(() => {
                  const ToolIcon = TOOLS.find((t) => t.id === activeTool)?.icon || Wand2;
                  return <ToolIcon className="h-4 w-4 text-blue-400" />;
                })()}
                {TOOLS.find((t) => t.id === activeTool)?.label}
              </div>

              {activeTool === 'convert' && (
                <div className="space-y-4">
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
                    <select value={colorSpace} onChange={(e) => setColorSpace(e.target.value as ColorSpace | '')} className="input-field h-10 w-full rounded-2xl px-3 text-sm">
                      <option value="">Color space: original</option>
                      <option value="srgb">sRGB</option>
                      <option value="cmyk">CMYK</option>
                      <option value="b-w">Black & white</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTool === 'resize' && (
                <div className="space-y-2">
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
              )}

              {activeTool === 'crop' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--text-muted)]">Drag on the image to draw a crop, or drag its handles/body to adjust.</p>
                  <OptionToggle options={CROP_PRESETS.map(({ value, label }) => ({ value, label }))} value={cropPreset} onChange={applyCropPreset} />
                  {cropRectPx && (
                    <button type="button" className="text-[10px] text-blue-400 hover:underline" onClick={() => { setCropX(''); setCropY(''); setCropWidth(''); setCropHeight(''); }}>
                      Reset selection
                    </button>
                  )}
                  {cropPreset === 'free' && (
                    <div className="flex flex-wrap gap-2">
                      <Input type="number" placeholder="X" value={cropX} onChange={(e) => setCropX(e.target.value)} className="h-10 w-24" />
                      <Input type="number" placeholder="Y" value={cropY} onChange={(e) => setCropY(e.target.value)} className="h-10 w-24" />
                      <Input type="number" placeholder="Width" value={cropWidth} onChange={(e) => setCropWidth(e.target.value)} className="h-10 w-24" />
                      <Input type="number" placeholder="Height" value={cropHeight} onChange={(e) => setCropHeight(e.target.value)} className="h-10 w-24" />
                    </div>
                  )}
                </div>
              )}

              {activeTool === 'transform' && (
                <div className="space-y-2">
                  <OptionToggle options={[{ value: '0', label: '0°' }, { value: '90', label: '90°' }, { value: '180', label: '180°' }, { value: '270', label: '270°' }]} value={String(rotate)} onChange={(v) => setRotate(Number(v) as 0 | 90 | 180 | 270)} />
                  <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={flipHorizontal} onChange={(e) => setFlipHorizontal(e.target.checked)} /> Flip horizontal</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={flipVertical} onChange={(e) => setFlipVertical(e.target.checked)} /> Flip vertical</label>
                  </div>
                </div>
              )}

              {activeTool === 'color' && (
                <div className="space-y-3">
                  {(brightness || contrast || saturation || hue) ? (
                    <div className="flex justify-end">
                      <button type="button" className="text-[10px] text-blue-400 hover:underline" onClick={() => { setBrightness(0); setContrast(0); setSaturation(0); setHue(0); }}>Reset all</button>
                    </div>
                  ) : null}
                  {[
                    { label: 'Brightness', value: brightness, set: setBrightness },
                    { label: 'Contrast', value: contrast, set: setContrast },
                    { label: 'Saturation', value: saturation, set: setSaturation },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                        <span>{row.label}</span>
                        <span>{row.value > 0 ? `+${row.value}` : row.value}</span>
                      </div>
                      <input type="range" min={-100} max={100} value={row.value} onChange={(e) => row.set(Number(e.target.value))} className="w-full accent-blue-500" />
                    </div>
                  ))}
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                      <span>Hue</span>
                      <span>{hue > 0 ? `+${hue}` : hue}°</span>
                    </div>
                    <input type="range" min={-180} max={180} value={hue} onChange={(e) => setHue(Number(e.target.value))} className="w-full accent-blue-500" />
                  </div>
                </div>
              )}

              {activeTool === 'watermark' && (
                <div className="space-y-3">
                  <Input placeholder="Watermark text (optional)" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} className="h-10" />
                  {watermarkText && (
                    <div className="grid grid-cols-2 gap-2">
                      <select value={watermarkFontFamily} onChange={(e) => setWatermarkFontFamily(e.target.value)} className="input-field h-10 rounded-2xl px-3 text-sm">
                        {WATERMARK_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-strong)] px-3">
                        <input type="color" value={watermarkColor} onChange={(e) => setWatermarkColor(e.target.value)} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
                        <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                          <input type="checkbox" checked={watermarkBold} onChange={(e) => setWatermarkBold(e.target.checked)} /> Bold
                        </label>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={watermarkFileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setWatermarkImageFile(e.target.files?.[0] || null)}
                      className="text-xs text-[var(--text-secondary)]"
                    />
                    {watermarkImageFile && (
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-rose-300"
                        onClick={() => { setWatermarkImageFile(null); if (watermarkFileInputRef.current) watermarkFileInputRef.current.value = ''; }}
                      >
                        <X className="h-3 w-3" /> {watermarkImageFile.name}
                      </button>
                    )}
                  </div>
                  {(watermarkText || watermarkImageFile) && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] text-[var(--text-muted)]">Opacity {watermarkOpacity}%</p>
                          <input type="range" min={10} max={100} value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(Number(e.target.value))} className="w-full accent-blue-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-[var(--text-muted)]">Scale {watermarkScale}%</p>
                          <input type="range" min={5} max={80} value={watermarkScale} onChange={(e) => setWatermarkScale(Number(e.target.value))} className="w-full accent-blue-500" />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] text-[var(--text-muted)]">Drag it directly on the image, or snap to:</p>
                        <div className="flex flex-wrap gap-2">
                          {WATERMARK_QUICK_POSITIONS.map((p) => (
                            <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => { setWatermarkXPercent(p.x); setWatermarkYPercent(p.y); }}>
                              {p.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTool === 'thumbnail' && (
                <div className="flex flex-wrap gap-2">
                  {THUMBNAIL_SIZES.map((size) => (
                    <Button key={size} type="button" size="sm" variant="outline" disabled={isProcessing} onClick={() => runProcess({ outputFormat: 'jpeg', quality: '85', resizeWidth: String(size) })}>
                      {size}px
                    </Button>
                  ))}
                </div>
              )}

              {activeTool === 'metadata' && (
                <div className="space-y-3">
                  <Button type="button" variant="outline" size="sm" onClick={loadMetadata} disabled={metadataLoading} className="w-full">
                    {metadataLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Info className="mr-2 h-3.5 w-3.5" />} Load metadata
                  </Button>
                  {metadata && (
                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-secondary)]">
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
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-[var(--border)] p-4">
              {resultUrl && resultJob && (
                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                    <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Original</p>
                    <p className="text-[var(--text-primary)]">{formatBytes(activeImage.fileSizeBytes)}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                    <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Result</p>
                    <p className="text-[var(--text-primary)]">
                      {formatBytes(resultJob.fileSizeBytes)} {savedPercent !== null && <span className={savedPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>({savedPercent >= 0 ? '-' : '+'}{Math.abs(savedPercent)}%)</span>}
                    </p>
                  </div>
                </div>
              )}
              <Button type="button" onClick={() => runProcess()} disabled={isProcessing} className="w-full">
                {isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</> : <><Wand2 className="mr-2 h-4 w-4" /> Apply & Process</>}
              </Button>
              {resultUrl && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => resultJob && handleDownload(resultJob.id)} className="flex-1">
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                  <Button type="button" variant="outline" size="icon" title="Copy file info" onClick={() => navigator.clipboard.writeText(JSON.stringify(resultJob, null, 2))}>
                    <Info className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
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
