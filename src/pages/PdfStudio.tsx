import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  UploadCloud, Combine, Scissors, Minimize2, ImageIcon, FileText, RotateCw, FileMinus,
  GripVertical, Lock, Unlock, ArrowLeft, Loader2, Download, Trash2, XCircle, CheckCircle2,
  AlertCircle, X, Plus, CheckSquare, FileStack, Clock3, PenLine, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useToast } from '@/src/components/ui/toast-provider';
import { useAuth } from '@/src/components/auth/AuthContext';
import { getApiBase } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';

type PdfOperation =
  | 'MERGE' | 'SPLIT' | 'COMPRESS' | 'PDF_TO_JPG' | 'JPG_TO_PDF'
  | 'ROTATE' | 'DELETE_PAGES' | 'REARRANGE' | 'PROTECT' | 'UNLOCK' | 'EDIT_TEXT';

type ToolId = 'merge' | 'split' | 'compress' | 'pdf-to-jpg' | 'jpg-to-pdf' | 'rotate' | 'delete-pages' | 'rearrange' | 'protect' | 'unlock' | 'edit-text';

interface ToolDef {
  id: ToolId;
  operation: PdfOperation;
  label: string;
  description: string;
  icon: typeof Combine;
  accept: string;
  accepts: 'pdf' | 'image';
  multi: boolean;
}

const TOOLS: ToolDef[] = [
  { id: 'merge', operation: 'MERGE', label: 'Merge PDF', description: 'Combine multiple PDFs into one file, in the order you choose.', icon: Combine, accept: '.pdf', accepts: 'pdf', multi: true },
  { id: 'split', operation: 'SPLIT', label: 'Split PDF', description: 'Extract every page or split by custom page ranges.', icon: Scissors, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'compress', operation: 'COMPRESS', label: 'Compress PDF', description: 'Shrink file size quickly, or hit an exact KB/MB target.', icon: Minimize2, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'pdf-to-jpg', operation: 'PDF_TO_JPG', label: 'PDF to Image', description: 'Convert every page into a high-quality JPG or PNG image.', icon: ImageIcon, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'jpg-to-pdf', operation: 'JPG_TO_PDF', label: 'Image to PDF', description: 'Turn one or more JPG, JPEG, or PNG images into a single PDF.', icon: FileText, accept: '.jpg,.jpeg,.png', accepts: 'image', multi: true },
  { id: 'rotate', operation: 'ROTATE', label: 'Rotate PDF', description: 'Rotate every page, or just the ones you pick.', icon: RotateCw, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'delete-pages', operation: 'DELETE_PAGES', label: 'Delete Pages', description: 'Remove unwanted pages from a PDF.', icon: FileMinus, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'rearrange', operation: 'REARRANGE', label: 'Rearrange Pages', description: 'Drag and drop to reorder pages.', icon: GripVertical, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'protect', operation: 'PROTECT', label: 'Protect PDF', description: 'Lock a PDF with a password.', icon: Lock, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'unlock', operation: 'UNLOCK', label: 'Unlock PDF', description: 'Remove a password from a protected PDF.', icon: Unlock, accept: '.pdf', accepts: 'pdf', multi: false },
  { id: 'edit-text', operation: 'EDIT_TEXT', label: 'Edit Text', description: 'Click any text on the page and replace it.', icon: PenLine, accept: '.pdf', accepts: 'pdf', multi: false },
];

interface PdfJob {
  id: string;
  operation: PdfOperation;
  originalFilename: string;
  inputFormat: string;
  outputFormat: string | null;
  fileSizeBytes: string | null;
  outputFileSizeBytes: string | null;
  pageCount: number | null;
  inputCount: number;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  errorMessage: string | null;
  resultMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadExpiresAt: string | null;
}

interface UploadResponse extends PdfJob {
  thumbnails: string[];
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

interface TextEdit {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  newText: string;
}

const ACTIVE_JOB_KEY = 'mediahub-pdfstudio-active-job';

interface StoredActiveJob {
  jobId: string;
  toolId: ToolId;
}

const STATUS_STYLES: Record<PdfJob['status'], string> = {
  QUEUED: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  PROCESSING: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
  COMPLETED: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  FAILED: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
};

const TOOL_LABEL: Record<PdfOperation, string> = {
  MERGE: 'Merge', SPLIT: 'Split', COMPRESS: 'Compress', PDF_TO_JPG: 'PDF to Image', JPG_TO_PDF: 'Image to PDF',
  ROTATE: 'Rotate', DELETE_PAGES: 'Delete pages', REARRANGE: 'Rearrange', PROTECT: 'Protect', UNLOCK: 'Unlock',
  EDIT_TEXT: 'Edit text',
};

function formatBytes(value: string | number | null) {
  if (value === null) return 'Unknown';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
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

function PageThumbGrid({
  thumbnails, order, mode, selected, onToggleSelect, onReorder,
}: {
  thumbnails: string[];
  order: number[];
  mode: 'select' | 'reorder';
  selected?: Set<number>;
  onToggleSelect?: (pageNum: number) => void;
  onReorder?: (order: number[]) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDrop = (dropIndex: number) => {
    const from = dragIndex.current;
    setOverIndex(null);
    if (from === null || from === dropIndex || !onReorder) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved);
    onReorder(next);
    dragIndex.current = null;
  };

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {order.map((pageNum, idx) => {
        const isSelected = selected?.has(pageNum);
        const thumbUrl = thumbnails[pageNum - 1];
        return (
          <div
            key={pageNum}
            draggable={mode === 'reorder'}
            onDragStart={() => { dragIndex.current = idx; }}
            onDragOver={(e) => { e.preventDefault(); setOverIndex(idx); }}
            onDragLeave={() => setOverIndex((cur) => (cur === idx ? null : cur))}
            onDrop={() => handleDrop(idx)}
            onClick={() => mode === 'select' && onToggleSelect?.(pageNum)}
            className={cn(
              'group relative select-none overflow-hidden rounded-xl border transition',
              mode === 'select' ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
              isSelected ? 'border-rose-500 ring-2 ring-rose-500/40' : 'border-[var(--border)] hover:border-[var(--border-strong)]',
              overIndex === idx && mode === 'reorder' && 'ring-2 ring-blue-500/50',
            )}
          >
            {thumbUrl ? (
              <img src={thumbUrl} alt={`Page ${pageNum}`} className="aspect-[3/4] w-full bg-white object-contain" draggable={false} />
            ) : (
              <div className="flex aspect-[3/4] w-full items-center justify-center bg-[var(--surface)] text-xs text-[var(--text-muted)]">Page {pageNum}</div>
            )}
            {isSelected && <div className="absolute inset-0 bg-rose-500/20" />}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
              <span>{mode === 'reorder' ? `#${idx + 1} · p.${pageNum}` : `Page ${pageNum}`}</span>
              {mode === 'reorder' && <GripVertical className="h-3 w-3 opacity-70" />}
              {mode === 'select' && isSelected && <CheckSquare className="h-3 w-3 text-rose-300" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TextEditCanvas({
  imageUrl, pageWidth, pageHeight, items, editedKeys, currentPage, onItemClick,
}: {
  imageUrl: string;
  pageWidth: number;
  pageHeight: number;
  items: TextItem[];
  editedKeys: Set<string>;
  currentPage: number;
  onItemClick: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = pageWidth > 0 ? width / pageWidth : 0;

  return (
    <div ref={containerRef} className="relative mx-auto w-full select-none overflow-hidden rounded-2xl border border-[var(--border)]">
      <img src={imageUrl} alt={`Page ${currentPage}`} className="block w-full" draggable={false} />
      {scale > 0 && items.map((item, index) => {
        const key = `${currentPage}:${index}`;
        const boxHeight = item.fontSize * scale * 1.3;
        const left = item.x * scale;
        const top = (pageHeight - item.y - item.height) * scale - boxHeight * 0.15;
        const boxWidth = Math.max(item.width * scale, 8);
        const isEdited = editedKeys.has(key);
        return (
          <button
            key={index}
            type="button"
            onClick={() => onItemClick(index)}
            title={item.text}
            style={{ position: 'absolute', left, top, width: boxWidth, height: boxHeight }}
            className={cn(
              'rounded-sm border transition',
              isEdited
                ? 'border-emerald-400 bg-emerald-400/25'
                : 'border-transparent bg-blue-500/0 hover:border-blue-400/70 hover:bg-blue-500/15',
            )}
          />
        );
      })}
    </div>
  );
}

export default function PdfStudio() {
  const { token } = useAuth();
  const { push } = useToast();
  const apiBase = getApiBase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedTool, setSelectedTool] = useState<ToolDef | null>(null);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedJob, setUploadedJob] = useState<UploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [activeJob, setActiveJob] = useState<PdfJob | null>(null);

  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // Split
  const [splitMode, setSplitMode] = useState<'each' | 'ranges'>('each');
  const [splitRanges, setSplitRanges] = useState<{ from: string; to: string }[]>([{ from: '1', to: '1' }]);

  // Compress
  const [compressMode, setCompressMode] = useState<'quick' | 'target'>('quick');
  const [compressLevel, setCompressLevel] = useState<'low' | 'recommended' | 'high'>('recommended');
  const [targetValue, setTargetValue] = useState('500');
  const [targetUnit, setTargetUnit] = useState<'KB' | 'MB'>('KB');

  // PDF -> Image
  const [pdfToJpgDpi, setPdfToJpgDpi] = useState(150);
  const [rasterFormat, setRasterFormat] = useState<'jpeg' | 'png'>('jpeg');

  // Rotate
  const [rotateAngle, setRotateAngle] = useState<90 | 180 | 270>(90);
  const [rotateAllPages, setRotateAllPages] = useState(true);
  const [rotatePages, setRotatePages] = useState<Set<number>>(new Set());

  // Delete pages
  const [deletePages, setDeletePages] = useState<Set<number>>(new Set());

  // Rearrange
  const [pageOrder, setPageOrder] = useState<number[]>([]);

  // Protect / Unlock
  const [protectPassword, setProtectPassword] = useState('');
  const [protectConfirm, setProtectConfirm] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');

  // Edit text
  const [editPageNumber, setEditPageNumber] = useState(1);
  const [editPageItems, setEditPageItems] = useState<TextItem[]>([]);
  const [editPageDims, setEditPageDims] = useState<{ width: number; height: number } | null>(null);
  const [editItemsLoading, setEditItemsLoading] = useState(false);
  const [textEdits, setTextEdits] = useState<Map<string, TextEdit>>(new Map());
  const [activeEditKey, setActiveEditKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${apiBase}/api/pdf/jobs`, { headers: { ...authHeaders }, credentials: 'include' });
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
  }, [token]);

  // Restore whatever tool session was active if this page was unmounted (e.g.
  // the user switched to another module) and comes back later - the uploaded
  // file and its job stay on the server, only the local view was lost.
  useEffect(() => {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return;
    let stored: StoredActiveJob;
    try {
      stored = JSON.parse(raw);
    } catch {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      return;
    }
    const tool = TOOLS.find((t) => t.id === stored.toolId);
    if (!tool) {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      return;
    }
    fetch(`${apiBase}/api/pdf/status/${stored.jobId}`, { headers: { ...authHeaders }, credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: UploadResponse | null) => {
        if (!data) {
          localStorage.removeItem(ACTIVE_JOB_KEY);
          return;
        }
        setSelectedTool(tool);
        setUploadedJob(data);
        initializeToolState(data);
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          setActiveJob(data);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!uploadedJob || selectedTool?.id !== 'edit-text') return;
    let cancelled = false;
    setEditItemsLoading(true);
    fetch(`${apiBase}/api/pdf/text-items/${uploadedJob.id}/${editPageNumber}`, { headers: { ...authHeaders }, credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { items: [], pageWidth: 0, pageHeight: 0 }))
      .then((data) => {
        if (cancelled) return;
        setEditPageItems(Array.isArray(data.items) ? data.items : []);
        setEditPageDims({ width: data.pageWidth || 0, height: data.pageHeight || 0 });
      })
      .catch(() => {
        if (!cancelled) { setEditPageItems([]); setEditPageDims(null); }
      })
      .finally(() => {
        if (!cancelled) setEditItemsLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedJob?.id, editPageNumber, selectedTool?.id]);

  const resetUpload = () => {
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setLocalFiles([]);
    setUploadedJob(null);
    setUploadError(null);
    setActiveJob(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSelectTool = (tool: ToolDef) => {
    resetUpload();
    setSelectedTool(tool);
  };

  const handleBackToTools = () => {
    resetUpload();
    setSelectedTool(null);
  };

  const initializeToolState = (job: UploadResponse) => {
    const pageCount = job.pageCount || 0;
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i + 1));
    setDeletePages(new Set());
    setRotatePages(new Set());
    setRotateAllPages(true);
    setSplitMode('each');
    setSplitRanges([{ from: '1', to: String(pageCount || 1) }]);
    setCompressMode('quick');
    setCompressLevel('recommended');
    setTargetValue('500');
    setTargetUnit('KB');
    setPdfToJpgDpi(150);
    setRasterFormat('jpeg');
    setProtectPassword('');
    setProtectConfirm('');
    setUnlockPassword('');
    setEditPageNumber(1);
    setEditPageItems([]);
    setEditPageDims(null);
    setTextEdits(new Map());
    setActiveEditKey(null);
    setEditDraft('');
  };

  const handleUpload = async (filesToUpload: File[]) => {
    if (!selectedTool || filesToUpload.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      filesToUpload.forEach((file) => formData.append('files', file));
      formData.append('operation', selectedTool.operation);
      const res = await fetch(`${apiBase}/api/pdf/upload`, {
        method: 'POST',
        headers: { ...authHeaders },
        body: formData,
        credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Upload failed. Please try again.');
      setUploadedJob(body);
      initializeToolState(body);
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: body.id, toolId: selectedTool.id }));
      push({ title: 'Upload complete', description: `${filesToUpload.length > 1 ? `${filesToUpload.length} files` : filesToUpload[0].name} ready to configure.` });
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed. Please try again.');
      setLocalFiles([]);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFilesChosen = (incoming: FileList | File[]) => {
    if (!selectedTool) return;
    const files = Array.from(incoming);
    if (files.length === 0) return;
    setUploadError(null);
    if (selectedTool.multi) {
      setLocalFiles((prev) => [...prev, ...files]);
    } else {
      setLocalFiles([files[0]]);
      void handleUpload([files[0]]);
    }
  };

  const handleRemoveLocalFile = (index: number) => {
    setLocalFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleReorderLocalFiles = (from: number, to: number) => {
    setLocalFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const buildProcessOptions = (): Record<string, any> => {
    if (!selectedTool) return {};
    switch (selectedTool.id) {
      case 'merge':
      case 'jpg-to-pdf':
        return {};
      case 'split':
        return splitMode === 'each'
          ? { mode: 'each' }
          : { mode: 'ranges', ranges: splitRanges.map((r) => ({ from: Number(r.from), to: Number(r.to) })) };
      case 'compress':
        return compressMode === 'quick'
          ? { mode: 'quick', level: compressLevel }
          : { mode: 'target', targetBytes: Math.round(Number(targetValue) * (targetUnit === 'MB' ? 1024 * 1024 : 1024)) };
      case 'pdf-to-jpg':
        return { dpi: pdfToJpgDpi, format: rasterFormat };
      case 'rotate':
        return { angle: rotateAngle, pages: rotateAllPages ? undefined : Array.from(rotatePages) };
      case 'delete-pages':
        return { pages: Array.from(deletePages) };
      case 'rearrange':
        return { order: pageOrder };
      case 'protect':
        return { password: protectPassword };
      case 'unlock':
        return { password: unlockPassword };
      case 'edit-text':
        return { edits: Array.from(textEdits.values()) };
      default:
        return {};
    }
  };

  const validateBeforeProcess = (): string | null => {
    if (!selectedTool || !uploadedJob) return 'Upload a file first.';
    const pageCount = uploadedJob.pageCount || 0;
    switch (selectedTool.id) {
      case 'split':
        if (splitMode === 'ranges') {
          for (const r of splitRanges) {
            const from = Number(r.from);
            const to = Number(r.to);
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return 'Enter valid page ranges.';
            if (pageCount && to > pageCount) return `This document only has ${pageCount} pages.`;
          }
        }
        return null;
      case 'compress':
        if (compressMode === 'target') {
          const n = Number(targetValue);
          if (!Number.isFinite(n) || n <= 0) return 'Enter a valid target size.';
        }
        return null;
      case 'rotate':
        if (!rotateAllPages && rotatePages.size === 0) return 'Select at least one page to rotate.';
        return null;
      case 'delete-pages':
        if (deletePages.size === 0) return 'Select at least one page to delete.';
        if (pageCount && deletePages.size >= pageCount) return 'You cannot delete every page.';
        return null;
      case 'protect':
        if (protectPassword.length < 4) return 'Password must be at least 4 characters.';
        if (protectPassword !== protectConfirm) return 'Passwords do not match.';
        return null;
      case 'unlock':
        if (!unlockPassword) return 'Enter the PDF password.';
        return null;
      case 'edit-text':
        if (textEdits.size === 0) return 'Click a piece of text and change it before saving.';
        return null;
      default:
        return null;
    }
  };

  const handleProcess = async () => {
    if (!uploadedJob || !selectedTool) return;
    const validationError = validateBeforeProcess();
    if (validationError) {
      push({ title: 'Check your input', description: validationError });
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch(`${apiBase}/api/pdf/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        credentials: 'include',
        body: JSON.stringify({ jobId: uploadedJob.id, ...buildProcessOptions() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Processing failed.');
      setActiveJob(body);
      fetchJobs();
      push({ title: `${selectedTool.label} complete`, description: body.resultMessage || 'Your file is ready to download.' });
    } catch (err: any) {
      push({ title: 'Processing failed', description: err.message || 'Please try again.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadJob = async (jobId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/pdf/download/${jobId}`, { headers: { ...authHeaders }, credentials: 'include' });
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
      await fetch(`${apiBase}/api/pdf/${jobId}`, { method: 'DELETE', headers: { ...authHeaders }, credentials: 'include' });
      if (activeJob?.id === jobId) resetUpload();
      fetchJobs();
    } catch {
      push({ title: 'Action failed', description: 'Could not remove this job.' });
    }
  };

  const toggleRotatePage = (pageNum: number) => {
    setRotatePages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) next.delete(pageNum); else next.add(pageNum);
      return next;
    });
  };

  const toggleDeletePage = (pageNum: number) => {
    setDeletePages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) next.delete(pageNum); else next.add(pageNum);
      return next;
    });
  };

  const openTextEdit = (index: number) => {
    const key = `${editPageNumber}:${index}`;
    const item = editPageItems[index];
    if (!item) return;
    setActiveEditKey(key);
    setEditDraft(textEdits.get(key)?.newText ?? item.text);
  };

  const confirmTextEdit = () => {
    if (!activeEditKey) return;
    const index = Number(activeEditKey.split(':')[1]);
    const item = editPageItems[index];
    if (!item) return;
    setTextEdits((prev) => {
      const next = new Map(prev);
      next.set(activeEditKey, {
        page: editPageNumber, x: item.x, y: item.y, width: item.width, height: item.height, fontSize: item.fontSize, newText: editDraft,
      });
      return next;
    });
    setActiveEditKey(null);
  };

  const cancelTextEdit = () => setActiveEditKey(null);

  const addSplitRange = () => setSplitRanges((prev) => [...prev, { from: '', to: '' }]);
  const removeSplitRange = (idx: number) => setSplitRanges((prev) => prev.filter((_, i) => i !== idx));
  const updateSplitRange = (idx: number, key: 'from' | 'to', value: string) => {
    setSplitRanges((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  // ---------------------------------------------------------------------
  // Render: tool grid
  // ---------------------------------------------------------------------

  if (!selectedTool) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">PDF Studio</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            A complete PDF toolkit - merge, split, compress, convert, rotate, reorder, and protect your documents.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <motion.button
                key={tool.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => handleSelectTool(tool)}
                className="flex flex-col items-start gap-3 rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel-bg)] p-6 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-blue-400">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[var(--text-primary)]">{tool.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{tool.description}</p>
                </div>
              </motion.button>
            );
          })}
        </div>

        {!jobsLoading && jobs.length > 0 && (
          <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Recent PDF jobs</h2>
            <div className="mt-4 space-y-3">
              {jobs.slice(0, 6).map((job) => (
                <JobRow key={job.id} job={job} onDownload={handleDownloadJob} onDelete={handleDeleteJob} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const Icon = selectedTool.icon;

  return (
    <div className="space-y-6">
      <button onClick={handleBackToTools} className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
        <ArrowLeft className="h-4 w-4" /> All PDF tools
      </button>

      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-blue-400">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{selectedTool.label}</h1>
          <p className="text-sm text-[var(--text-muted)]">{selectedTool.description}</p>
        </div>
      </div>

      <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        {!uploadedJob ? (
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                if (e.dataTransfer.files?.length) handleFilesChosen(e.dataTransfer.files);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-3 rounded-[1.5rem] border-2 border-dashed p-10 text-center transition',
                isDraggingOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-[var(--border)]',
              )}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
                  <p className="text-sm font-medium text-[var(--text-primary)]">Uploading and validating your file…</p>
                </>
              ) : (
                <>
                  <UploadCloud className="h-10 w-10 text-[var(--text-secondary)]" />
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Drag and drop {selectedTool.multi ? 'files' : 'a file'} here
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Accepts {selectedTool.accepts === 'pdf' ? 'PDF files' : 'JPG and PNG images'}
                    {selectedTool.multi ? ' - add as many as you need' : ''}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Browse files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={selectedTool.accept}
                    multiple={selectedTool.multi}
                    className="hidden"
                    onChange={(e) => { if (e.target.files) handleFilesChosen(e.target.files); }}
                  />
                </>
              )}
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {uploadError}
              </div>
            )}

            {selectedTool.multi && localFiles.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                  {localFiles.length} file{localFiles.length > 1 ? 's' : ''} selected - drag to reorder
                </p>
                <div className="space-y-2">
                  {localFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData('text/plain'));
                        if (!Number.isNaN(from)) handleReorderLocalFiles(from, index);
                      }}
                      className="flex cursor-grab items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                      <span className="w-6 shrink-0 text-xs text-[var(--text-muted)]">#{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{file.name}</span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">{formatBytes(file.size)}</span>
                      <button onClick={() => handleRemoveLocalFile(index)} className="shrink-0 rounded-full p-1 text-[var(--text-secondary)] hover:text-rose-400" aria-label="Remove file">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Plus className="mr-2 h-4 w-4" /> Add more files
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleUpload(localFiles)}
                    disabled={isUploading || localFiles.length < (selectedTool.id === 'merge' ? 2 : 1)}
                  >
                    {isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : 'Continue'}
                  </Button>
                </div>
                {selectedTool.id === 'merge' && localFiles.length === 1 && (
                  <p className="text-xs text-amber-400">Add at least one more PDF to merge.</p>
                )}
              </div>
            )}
          </div>
        ) : !activeJob ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]">
                  <FileStack className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{uploadedJob.originalFilename}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {uploadedJob.pageCount ? `${uploadedJob.pageCount} pages · ` : ''}{formatBytes(uploadedJob.fileSizeBytes)}
                  </p>
                </div>
              </div>
              <button onClick={resetUpload} className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]" aria-label="Start over">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Split */}
            {selectedTool.id === 'split' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Split mode</p>
                  <OptionToggle
                    options={[{ value: 'each', label: 'Extract every page' }, { value: 'ranges', label: 'Custom ranges' }]}
                    value={splitMode}
                    onChange={setSplitMode}
                  />
                </div>
                {splitMode === 'each' ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Produces {uploadedJob.pageCount || 'N'} separate single-page PDFs, delivered as a ZIP.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {splitRanges.map((range, idx) => (
                      <div key={idx} className="flex items-center gap-3">
                        <Input type="number" min={1} placeholder="From" value={range.from} onChange={(e) => updateSplitRange(idx, 'from', e.target.value)} className="h-10 w-28" />
                        <span className="text-xs text-[var(--text-muted)]">to</span>
                        <Input type="number" min={1} placeholder="To" value={range.to} onChange={(e) => updateSplitRange(idx, 'to', e.target.value)} className="h-10 w-28" />
                        {splitRanges.length > 1 && (
                          <button onClick={() => removeSplitRange(idx)} className="rounded-full p-1 text-[var(--text-secondary)] hover:text-rose-400" aria-label="Remove range">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addSplitRange}>
                      <Plus className="mr-2 h-4 w-4" /> Add range
                    </Button>
                    <p className="text-xs text-[var(--text-muted)]">Each range becomes its own PDF, delivered as a ZIP.</p>
                  </div>
                )}
              </div>
            )}

            {/* Compress */}
            {selectedTool.id === 'compress' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Compression mode</p>
                  <OptionToggle
                    options={[{ value: 'quick', label: 'Quick compression' }, { value: 'target', label: 'Target file size' }]}
                    value={compressMode}
                    onChange={setCompressMode}
                  />
                </div>
                {compressMode === 'quick' ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Level</p>
                    <OptionToggle
                      options={[{ value: 'low', label: 'Low (best quality)' }, { value: 'recommended', label: 'Recommended' }, { value: 'high', label: 'High (smallest)' }]}
                      value={compressLevel}
                      onChange={setCompressLevel}
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Input type="number" min={1} step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className="h-10 w-32" />
                    <OptionToggle options={[{ value: 'KB', label: 'KB' }, { value: 'MB', label: 'MB' }]} value={targetUnit} onChange={setTargetUnit} />
                    <span className="text-xs text-[var(--text-muted)]">Current size: {formatBytes(uploadedJob.fileSizeBytes)}</span>
                  </div>
                )}
              </div>
            )}

            {/* PDF to Image */}
            {selectedTool.id === 'pdf-to-jpg' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Output format</p>
                  <OptionToggle
                    options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }]}
                    value={rasterFormat}
                    onChange={setRasterFormat}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Image quality</p>
                  <OptionToggle
                    options={[{ value: 96, label: 'Web (96 DPI)' }, { value: 150, label: 'Standard (150 DPI)' }, { value: 300, label: 'High (300 DPI)' }]}
                    value={pdfToJpgDpi}
                    onChange={setPdfToJpgDpi}
                  />
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {(uploadedJob.pageCount || 1) > 1 ? `Multiple pages will be delivered as a ZIP of ${rasterFormat === 'png' ? 'PNGs' : 'JPGs'}.` : `Delivered as a single ${rasterFormat === 'png' ? 'PNG' : 'JPG'}.`}
                </p>
              </div>
            )}

            {/* Image to PDF */}
            {selectedTool.id === 'jpg-to-pdf' && (
              <p className="text-sm text-[var(--text-muted)]">
                {uploadedJob.inputCount} image{uploadedJob.inputCount > 1 ? 's' : ''} will become {uploadedJob.inputCount > 1 ? 'pages in one PDF, in the order uploaded' : 'a single-page PDF'}.
              </p>
            )}

            {/* Rotate */}
            {selectedTool.id === 'rotate' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Rotate by</p>
                  <OptionToggle options={[{ value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }]} value={rotateAngle} onChange={setRotateAngle} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Pages</p>
                  <OptionToggle
                    options={[{ value: 'all', label: 'All pages' }, { value: 'pick', label: 'Choose pages' }]}
                    value={rotateAllPages ? 'all' : 'pick'}
                    onChange={(v) => setRotateAllPages(v === 'all')}
                  />
                </div>
                {!rotateAllPages && (
                  uploadedJob.thumbnails.length > 0 ? (
                    <PageThumbGrid
                      thumbnails={uploadedJob.thumbnails}
                      order={pageOrder}
                      mode="select"
                      selected={rotatePages}
                      onToggleSelect={toggleRotatePage}
                    />
                  ) : (
                    <p className="text-xs text-amber-400">Page previews aren't available for this document - rotating all pages instead.</p>
                  )
                )}
              </div>
            )}

            {/* Delete pages */}
            {selectedTool.id === 'delete-pages' && (
              uploadedJob.thumbnails.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-muted)]">Click pages to mark them for deletion ({deletePages.size} selected).</p>
                  <PageThumbGrid thumbnails={uploadedJob.thumbnails} order={pageOrder} mode="select" selected={deletePages} onToggleSelect={toggleDeletePage} />
                </div>
              ) : (
                <p className="text-sm text-amber-400">Page previews aren't available for this document (too many pages to preview).</p>
              )
            )}

            {/* Rearrange */}
            {selectedTool.id === 'rearrange' && (
              uploadedJob.thumbnails.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-muted)]">Drag pages to reorder them.</p>
                  <PageThumbGrid thumbnails={uploadedJob.thumbnails} order={pageOrder} mode="reorder" onReorder={setPageOrder} />
                </div>
              ) : (
                <p className="text-sm text-rose-400">Page previews aren't available for this document, so it can't be visually reordered.</p>
              )
            )}

            {/* Protect */}
            {selectedTool.id === 'protect' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                  Password
                  <Input type="password" value={protectPassword} onChange={(e) => setProtectPassword(e.target.value)} placeholder="At least 4 characters" />
                </label>
                <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                  Confirm password
                  <Input type="password" value={protectConfirm} onChange={(e) => setProtectConfirm(e.target.value)} placeholder="Repeat password" />
                </label>
              </div>
            )}

            {/* Unlock */}
            {selectedTool.id === 'unlock' && (
              <label className="block max-w-sm space-y-2 text-sm text-[var(--text-secondary)]">
                Current password
                <Input type="password" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} placeholder="Enter the PDF's password" />
              </label>
            )}

            {/* Edit text */}
            {selectedTool.id === 'edit-text' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
                  Click any piece of text below to replace it. The replacement is drawn over the original at the same
                  spot and size - it works best for short swaps on standard fonts, and the original text may still be
                  present underneath (not a secure redaction).
                </div>

                <div className="flex items-center justify-between">
                  <Button
                    type="button" variant="outline" size="sm"
                    disabled={editPageNumber <= 1}
                    onClick={() => setEditPageNumber((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-[var(--text-muted)]">
                    Page {editPageNumber} of {uploadedJob.pageCount || 1}
                  </span>
                  <Button
                    type="button" variant="outline" size="sm"
                    disabled={editPageNumber >= (uploadedJob.pageCount || 1)}
                    onClick={() => setEditPageNumber((p) => Math.min(uploadedJob.pageCount || 1, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                {editItemsLoading ? (
                  <Skeleton className="h-96 w-full" />
                ) : !uploadedJob.thumbnails[editPageNumber - 1] || !editPageDims?.width ? (
                  <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                    Couldn't load a preview for this page.
                  </p>
                ) : editPageItems.length === 0 ? (
                  <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                    No selectable text found on this page (it may be a scanned image).
                  </p>
                ) : (
                  <TextEditCanvas
                    imageUrl={uploadedJob.thumbnails[editPageNumber - 1]}
                    pageWidth={editPageDims.width}
                    pageHeight={editPageDims.height}
                    items={editPageItems}
                    editedKeys={new Set(textEdits.keys())}
                    currentPage={editPageNumber}
                    onItemClick={openTextEdit}
                  />
                )}

                {activeEditKey !== null && (
                  <div className="space-y-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Replacement text</p>
                    <Input
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      placeholder="Type the new text"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmTextEdit(); if (e.key === 'Escape') cancelTextEdit(); }}
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={confirmTextEdit}>
                        <Check className="mr-2 h-4 w-4" /> Confirm
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelTextEdit}>Cancel</Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-[var(--text-muted)]">
                  {textEdits.size === 0 ? 'No changes yet.' : `${textEdits.size} edit${textEdits.size > 1 ? 's' : ''} ready to save.`}
                </p>
              </div>
            )}

            <Button type="button" onClick={handleProcess} disabled={isProcessing} className="w-full md:w-auto">
              {isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</> : selectedTool.label}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium', STATUS_STYLES[activeJob.status])}>
                {(activeJob.status === 'QUEUED' || activeJob.status === 'PROCESSING') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {activeJob.status === 'COMPLETED' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {activeJob.status === 'FAILED' && <AlertCircle className="h-3.5 w-3.5" />}
                {activeJob.status}
              </span>
              {activeJob.outputFileSizeBytes && <span className="text-[var(--text-muted)]">{formatBytes(activeJob.outputFileSizeBytes)}</span>}
            </div>
            {activeJob.resultMessage && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">{activeJob.resultMessage}</div>
            )}
            {activeJob.errorMessage && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{activeJob.errorMessage}</div>
            )}
            <div className="flex flex-wrap gap-3">
              {activeJob.status === 'COMPLETED' && (
                <Button type="button" onClick={() => handleDownloadJob(activeJob.id)}>
                  <Download className="mr-2 h-4 w-4" /> Download
                </Button>
              )}
              <Button type="button" variant="outline" onClick={resetUpload}>
                {selectedTool.label} again
              </Button>
              <Button type="button" variant="outline" onClick={handleBackToTools}>
                Choose another tool
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">PDF job history</h2>
        <div className="mt-4">
          {jobsLoading ? (
            <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          ) : jobs.length === 0 ? (
            <EmptyState icon={FileStack} title="No PDF jobs yet" description="Files you process will be tracked here with status and download actions." />
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} onDownload={handleDownloadJob} onDelete={handleDeleteJob} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const JobRow: React.FC<{ job: PdfJob; onDownload: (id: string) => void; onDelete: (id: string) => void }> = ({ job, onDownload, onDelete }) => {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)] md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
          <FileStack className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-[var(--text-primary)]">{job.originalFilename}</p>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.2em]', STATUS_STYLES[job.status])}>
              {(job.status === 'QUEUED' || job.status === 'PROCESSING') && <Loader2 className="h-3 w-3 animate-spin" />}
              {job.status}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
            <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {TOOL_LABEL[job.operation]}</span>
            <span>{formatBytes(job.outputFileSizeBytes ?? job.fileSizeBytes)}</span>
            {job.errorMessage && <span className="text-rose-300">{job.errorMessage}</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {job.status === 'COMPLETED' && (
          <button onClick={() => onDownload(job.id)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Download">
            <Download className="h-4 w-4" />
          </button>
        )}
        <button onClick={() => onDelete(job.id)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Delete">
          {job.status === 'QUEUED' || job.status === 'PROCESSING' ? <XCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </motion.div>
  );
};
