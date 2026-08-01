import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  UploadCloud, Eraser, Wand2, Palette, PaintBucket, ImagePlus, ZoomIn, ZoomOut, Hand,
  Undo2, Redo2, Download, Loader2, X, Check, RotateCcw, Droplet,
} from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useToast } from '@/src/components/ui/toast-provider';
import { useAuth } from '@/src/components/auth/AuthContext';
import { getApiBase } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';

// ===========================================================================
// Types
// ===========================================================================

type ToolId = 'brush' | 'magic' | 'white-bg' | 'green-screen' | 'bg-color' | 'bg-image' | 'hand';

type BgFillMode = 'none' | 'white' | 'black' | 'custom' | 'gradient';
type BgImageFit = 'cover' | 'contain' | 'stretch' | 'center';
type ExportFormat = 'png' | 'jpeg' | 'webp';

interface HistoryEntry {
  imageData: ImageData;
}

// ===========================================================================
// Pixel-math helpers (pure functions, unit-testable independent of React/DOM)
// ===========================================================================

/** Euclidean RGB distance, 0 (identical) to ~441.67 (black vs white). */
export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 3);

/** Maps a 0-100 tolerance slider to a 0..MAX_COLOR_DISTANCE threshold. */
export function toleranceToDistance(tolerance: number): number {
  return (Math.max(0, Math.min(100, tolerance)) / 100) * MAX_COLOR_DISTANCE;
}

/** Brush hardness falloff: 1 at center, tapering to 0 at the radius edge. */
export function brushFalloff(distance: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  const t = distance / radius;
  if (t >= 1) return 0;
  const h = Math.max(0, Math.min(100, hardness)) / 100;
  if (t <= h) return 1;
  if (h >= 1) return 1;
  return 1 - (t - h) / (1 - h);
}

/** Soft-edge alpha multiplier for magic-eraser-style tools: 1 inside the
 * tolerance threshold, fading linearly to 0 across the softness margin. */
export function edgeSoftAlpha(distance: number, threshold: number, softnessMargin: number): number {
  if (distance <= threshold) return 1;
  if (softnessMargin <= 0) return 0;
  const t = (distance - threshold) / softnessMargin;
  if (t >= 1) return 0;
  return 1 - t;
}

// ===========================================================================
// Canvas pixel operations (operate directly on ImageData.data Uint8ClampedArray)
// ===========================================================================

function eraseBrushDab(data: Uint8ClampedArray, width: number, height: number, cx: number, cy: number, radius: number, hardness: number, opacity: number) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  const opacityFrac = Math.max(0, Math.min(100, opacity)) / 100;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const falloff = brushFalloff(dist, radius, hardness);
      if (falloff <= 0) continue;
      const idx = (y * width + x) * 4 + 3;
      const reduction = falloff * opacityFrac * 255;
      data[idx] = Math.max(0, data[idx] - reduction);
    }
  }
}

/**
 * Erases pixels matching a target color within `tolerance`, with a soft
 * fade over `edgeSoftness` (0-100). If `contiguous`, flood-fills outward
 * from (startX, startY) rather than scanning every pixel in the image -
 * used by the Magic Color Eraser when the user wants to keep same-colored
 * regions elsewhere in the image untouched.
 */
function eraseByColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
  tolerance: number,
  edgeSoftness: number,
  contiguous: boolean,
  startX?: number,
  startY?: number,
) {
  const threshold = toleranceToDistance(tolerance);
  const softMargin = Math.max(1, (Math.max(0, Math.min(100, edgeSoftness)) / 100) * (MAX_COLOR_DISTANCE * 0.35));

  if (!contiguous) {
    const total = width * height;
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], target.r, target.g, target.b);
      // similarity: 1 = matches the target color closely (erase it), 0 = very different (keep it).
      const similarity = edgeSoftAlpha(dist, threshold, softMargin);
      if (similarity > 0) data[idx + 3] = Math.round(data[idx + 3] * (1 - similarity));
    }
    return;
  }

  if (startX === undefined || startY === undefined) return;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [startX, startY];
  visited[startY * width + startX] = 1;

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const idx = (y * width + x) * 4;
    const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], target.r, target.g, target.b);
    // similarity: 1 = matches the target color closely (erase it), 0 = very different - stop expanding here.
    const similarity = edgeSoftAlpha(dist, threshold, softMargin);
    if (similarity <= 0) continue;
    data[idx + 3] = Math.round(data[idx + 3] * (1 - similarity));

    if (x + 1 < width && !visited[y * width + x + 1]) { visited[y * width + x + 1] = 1; stack.push(x + 1, y); }
    if (x - 1 >= 0 && !visited[y * width + x - 1]) { visited[y * width + x - 1] = 1; stack.push(x - 1, y); }
    if (y + 1 < height && !visited[(y + 1) * width + x]) { visited[(y + 1) * width + x] = 1; stack.push(x, y + 1); }
    if (y - 1 >= 0 && !visited[(y - 1) * width + x]) { visited[(y - 1) * width + x] = 1; stack.push(x, y - 1); }
  }
}

/** Separable box blur applied only to the alpha channel - a fast, good-enough
 * approximation of a feather/edge-smoothing blur for transparency edges. */
function featherAlpha(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return;
  const r = Math.max(1, Math.round(radius));
  const src = new Uint8ClampedArray(data.length);
  for (let i = 3; i < data.length; i += 4) src[i] = data[i];

  const temp = new Float32Array(width * height);
  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        sum += src[(y * width + nx) * 4 + 3];
        count++;
      }
      temp[y * width + x] = sum / count;
    }
  }
  // Vertical pass, writing back into the alpha channel
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        sum += temp[ny * width + x];
        count++;
      }
      data[(y * width + x) * 4 + 3] = Math.round(sum / count);
    }
  }
}

/**
 * Green-screen chroma key: erases pixels where green dominates red/blue
 * (the classic `g - max(r,b)` greenness score), then reduces green "spill"
 * bleeding onto the remaining foreground edges by pulling the green channel
 * back toward the red/blue average wherever greenness is still elevated.
 */
function chromaKeyGreen(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance: number,
  edgeSmoothing: number,
  spillReduction: number,
) {
  const SCORE_RANGE = 255;
  const threshold = (Math.max(0, Math.min(100, tolerance)) / 100) * SCORE_RANGE;
  const softMargin = Math.max(1, (Math.max(0, Math.min(100, edgeSmoothing)) / 100) * SCORE_RANGE * 0.6);
  const spillFrac = Math.max(0, Math.min(100, spillReduction)) / 100;

  const total = width * height;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const greenScore = g - Math.max(r, b);
    if (greenScore <= 0) continue;

    let similarity: number;
    if (greenScore >= threshold) similarity = 1;
    else if (greenScore <= threshold - softMargin) similarity = 0;
    else similarity = (greenScore - (threshold - softMargin)) / softMargin;

    if (similarity > 0) {
      data[idx + 3] = Math.round(data[idx + 3] * (1 - similarity));
    }
    if (spillFrac > 0) {
      const avgRB = (r + b) / 2;
      if (g > avgRB) {
        data[idx + 1] = Math.round(g - (g - avgRB) * spillFrac);
      }
    }
  }
}

interface BackgroundFillSpec {
  mode: BgFillMode;
  customColor: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  image: HTMLImageElement | null;
  imageFit: BgImageFit;
}

/** Paints whatever background (solid/gradient/image) is currently selected
 * onto a canvas context - called before drawing the working canvas on top,
 * so transparent areas show this instead of nothing. No-op for mode 'none'. */
function drawBackgroundFill(ctx: CanvasRenderingContext2D, width: number, height: number, spec: BackgroundFillSpec) {
  if (spec.mode === 'none') return;

  if (spec.mode === 'white' || spec.mode === 'black' || spec.mode === 'custom') {
    ctx.fillStyle = spec.mode === 'white' ? '#ffffff' : spec.mode === 'black' ? '#000000' : spec.customColor;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  if (spec.mode === 'gradient') {
    const rad = (spec.gradientAngle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const half = Math.sqrt(width * width + height * height) / 2;
    const cx = width / 2;
    const cy = height / 2;
    const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    grad.addColorStop(0, spec.gradientFrom);
    grad.addColorStop(1, spec.gradientTo);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  if (spec.mode === 'image' && spec.image) {
    const img = spec.image;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;
    const imgRatio = iw / ih;
    const boxRatio = width / height;

    if (spec.imageFit === 'stretch') {
      ctx.drawImage(img, 0, 0, width, height);
    } else if (spec.imageFit === 'center') {
      ctx.drawImage(img, (width - iw) / 2, (height - ih) / 2, iw, ih);
    } else if (spec.imageFit === 'contain') {
      const scale = imgRatio > boxRatio ? width / iw : height / ih;
      const w = iw * scale;
      const h = ih * scale;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
    } else {
      // cover
      const scale = imgRatio > boxRatio ? height / ih : width / iw;
      const w = iw * scale;
      const h = ih * scale;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
    }
  }
}

/** Apply/Reset controls shown under any tool that computes a non-destructive
 * preview (Magic Eraser, White BG, Green Screen) - only rendered once a
 * preview is actually pending. */
function PreviewApplyBar({ visible, onApply, onReset }: { visible: boolean; onApply: () => void; onReset: () => void }) {
  if (!visible) return null;
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" onClick={onApply}><Check className="mr-2 h-4 w-4" /> Apply</Button>
      <Button type="button" size="sm" variant="outline" onClick={onReset}>Reset</Button>
    </div>
  );
}

export default function BackgroundEditor() {
  const { token } = useAuth();
  const { push } = useToast();
  const apiBase = getApiBase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  // working = the editable RGBA pixel buffer, kept as a detached in-memory
  // canvas (never mounted in the DOM) so it exists independently of whether
  // the "loaded" view has rendered yet. display = the visible canvas the
  // user actually sees, only mounted once an image is loaded.
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const getWorkingCanvas = (): HTMLCanvasElement => {
    if (!workingCanvasRef.current) {
      workingCanvasRef.current = document.createElement('canvas');
    }
    return workingCanvasRef.current;
  };

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [activeTool, setActiveTool] = useState<ToolId>('brush');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef({ x: 0, y: 0 });

  // Scale the image down (or up) to fill the viewport like an artboard,
  // instead of always showing it at native pixel size - large photos would
  // otherwise force the canvas (and the whole page) wider than the screen.
  const computeFitZoom = useCallback((): number => {
    const viewport = viewportRef.current;
    if (!viewport || imageDims.width === 0 || imageDims.height === 0) return 1;
    const availW = viewport.clientWidth;
    const availH = viewport.clientHeight;
    if (availW === 0 || availH === 0) return 1;
    return Math.min(availW / imageDims.width, availH / imageDims.height);
  }, [imageDims.width, imageDims.height]);

  // Runs synchronously after the editor view (and viewportRef) mounts, so the
  // oversized native-resolution frame never flashes on screen before snapping to fit.
  useLayoutEffect(() => {
    if (!imageLoaded) return;
    setZoom(computeFitZoom());
    setPan({ x: 0, y: 0 });
  }, [imageLoaded, computeFitZoom]);

  // Brush settings
  const [brushSize, setBrushSize] = useState(40);
  const [brushHardness, setBrushHardness] = useState(80);
  const [brushOpacity, setBrushOpacity] = useState(100);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const strokeStartedRef = useRef(false);

  // Magic Color Eraser
  const [magicTolerance, setMagicTolerance] = useState(30);
  const [magicEdgeSoftness, setMagicEdgeSoftness] = useState(15);
  const [magicContiguous, setMagicContiguous] = useState(true);
  const [magicClickPoint, setMagicClickPoint] = useState<{ x: number; y: number } | null>(null);

  // White Background Remover
  const [whiteBgTolerance, setWhiteBgTolerance] = useState(25);
  const [whiteBgEdgeSmoothing, setWhiteBgEdgeSmoothing] = useState(15);
  const [whiteBgFeather, setWhiteBgFeather] = useState(2);

  // Green Screen
  const [greenTolerance, setGreenTolerance] = useState(35);
  const [greenEdgeSmoothing, setGreenEdgeSmoothing] = useState(15);
  const [greenSpillReduction, setGreenSpillReduction] = useState(50);

  // Pending preview: a computed-but-not-yet-committed edit, shown in the
  // display canvas without mutating the working canvas until Apply.
  const [pendingPreview, setPendingPreview] = useState<ImageData | null>(null);

  // Replace Background Color - a non-destructive display/export compositing
  // choice: drawn *behind* the transparent working canvas, live, until the
  // user explicitly Applies it (which flattens it permanently).
  const [bgFillMode, setBgFillMode] = useState<BgFillMode>('none');
  const [bgCustomColor, setBgCustomColor] = useState('#3b82f6');
  const [bgGradientFrom, setBgGradientFrom] = useState('#3b82f6');
  const [bgGradientTo, setBgGradientTo] = useState('#8b5cf6');
  const [bgGradientAngle, setBgGradientAngle] = useState(45);

  // Background Image compositing
  const [bgImageEl, setBgImageEl] = useState<HTMLImageElement | null>(null);
  const [bgImageFit, setBgImageFit] = useState<BgImageFit>('cover');

  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportQuality, setExportQuality] = useState(90);
  const [preserveMetadata, setPreserveMetadata] = useState(false);

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  // -------------------------------------------------------------------------
  // Image loading
  // -------------------------------------------------------------------------

  // Resets every tool setting back to its default - called before loading a
  // fresh image so a new editing session never inherits state (background
  // fill, pending previews, click points) left over from a previous image.
  const resetToolState = useCallback(() => {
    setActiveTool('brush');
    setPendingPreview(null);
    setMagicClickPoint(null);
    setMagicTolerance(30);
    setMagicEdgeSoftness(15);
    setMagicContiguous(true);
    setWhiteBgTolerance(25);
    setWhiteBgEdgeSmoothing(15);
    setWhiteBgFeather(2);
    setGreenTolerance(35);
    setGreenEdgeSmoothing(15);
    setGreenSpillReduction(50);
    setBgFillMode('none');
    setBgImageEl(null);
    setBgImageFit('cover');
  }, []);

  const loadImageFile = useCallback((file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resetToolState();
      const working = getWorkingCanvas();
      working.width = img.naturalWidth;
      working.height = img.naturalHeight;
      const wCtx = working.getContext('2d')!;
      wCtx.clearRect(0, 0, working.width, working.height);
      wCtx.drawImage(img, 0, 0);
      const initialData = wCtx.getImageData(0, 0, working.width, working.height);
      setHistory([{ imageData: initialData }]);
      setHistoryIndex(0);
      setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      setImageLoaded(true);
      setSourceFile(file);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      push({ title: 'Could not load image', description: 'Please try a different file.' });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [push, resetToolState]);

  const handleFilesChosen = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      push({ title: 'Unsupported file', description: 'Please choose an image file.' });
      return;
    }
    loadImageFile(file);
  };

  // -------------------------------------------------------------------------
  // Redraw display canvas: background fill (if any) behind, working canvas on top.
  // -------------------------------------------------------------------------

  const redrawDisplay = useCallback(() => {
    const working = workingCanvasRef.current;
    const display = displayCanvasRef.current;
    if (!working || !display) return;
    if (display.width !== working.width || display.height !== working.height) {
      display.width = working.width;
      display.height = working.height;
    }
    const dCtx = display.getContext('2d')!;
    dCtx.clearRect(0, 0, display.width, display.height);
    drawBackgroundFill(dCtx, display.width, display.height, {
      mode: bgFillMode,
      customColor: bgCustomColor,
      gradientFrom: bgGradientFrom,
      gradientTo: bgGradientTo,
      gradientAngle: bgGradientAngle,
      image: bgImageEl,
      imageFit: bgImageFit,
    });
    dCtx.drawImage(working, 0, 0);
  }, [bgFillMode, bgCustomColor, bgGradientFrom, bgGradientTo, bgGradientAngle, bgImageEl, bgImageFit]);

  useEffect(() => {
    if (imageLoaded) redrawDisplay();
  }, [imageLoaded, redrawDisplay]);

  // -------------------------------------------------------------------------
  // History (undo/redo)
  // -------------------------------------------------------------------------

  const pushHistory = useCallback((imageData: ImageData) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, { imageData }];
      // Cap history depth to bound memory use on large images.
      const MAX_HISTORY = 30;
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 29));
  }, [historyIndex]);

  const commitWorkingCanvas = useCallback(() => {
    const working = workingCanvasRef.current;
    if (!working) return;
    const ctx = working.getContext('2d')!;
    const data = ctx.getImageData(0, 0, working.width, working.height);
    pushHistory(data);
  }, [pushHistory]);

  const applyHistoryEntry = useCallback((index: number) => {
    const entry = history[index];
    const working = workingCanvasRef.current;
    if (!entry || !working) return;
    const ctx = working.getContext('2d')!;
    ctx.putImageData(entry.imageData, 0, 0);
    redrawDisplay();
  }, [history, redrawDisplay]);

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const next = historyIndex - 1;
    setHistoryIndex(next);
    applyHistoryEntry(next);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const next = historyIndex + 1;
    setHistoryIndex(next);
    applyHistoryEntry(next);
  };

  // -------------------------------------------------------------------------
  // Pending preview: Magic Eraser / White BG / Green Screen compute their
  // effect into `pendingPreview` (shown in the display canvas) without
  // touching the working canvas until the user clicks Apply.
  // -------------------------------------------------------------------------

  const clearPreview = useCallback(() => {
    setPendingPreview(null);
    redrawDisplay();
  }, [redrawDisplay]);

  const showPreview = useCallback((data: ImageData) => {
    setPendingPreview(data);
    const display = displayCanvasRef.current;
    if (!display) return;
    if (display.width !== data.width || display.height !== data.height) {
      display.width = data.width;
      display.height = data.height;
    }
    display.getContext('2d')!.putImageData(data, 0, 0);
  }, []);

  const recomputeMagicPreview = useCallback(() => {
    if (!magicClickPoint) return;
    const working = workingCanvasRef.current;
    if (!working) return;
    const ctx = working.getContext('2d')!;
    const data = ctx.getImageData(0, 0, working.width, working.height);
    const clone = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
    const x = Math.min(working.width - 1, Math.max(0, Math.round(magicClickPoint.x)));
    const y = Math.min(working.height - 1, Math.max(0, Math.round(magicClickPoint.y)));
    const idx = (y * working.width + x) * 4;
    const target = { r: data.data[idx], g: data.data[idx + 1], b: data.data[idx + 2] };
    eraseByColor(clone.data, clone.width, clone.height, target, magicTolerance, magicEdgeSoftness, magicContiguous, x, y);
    showPreview(clone);
  }, [magicClickPoint, magicTolerance, magicEdgeSoftness, magicContiguous, showPreview]);

  // Recompute the magic-eraser preview whenever its settings or click point
  // change (but only while that tool is active - see the tool-switch effect below).
  useEffect(() => {
    if (activeTool === 'magic' && magicClickPoint) recomputeMagicPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magicTolerance, magicEdgeSoftness, magicContiguous, magicClickPoint]);

  const recomputeWhiteBgPreview = useCallback(() => {
    const working = workingCanvasRef.current;
    if (!working) return;
    const ctx = working.getContext('2d')!;
    const data = ctx.getImageData(0, 0, working.width, working.height);
    const clone = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
    eraseByColor(clone.data, clone.width, clone.height, { r: 255, g: 255, b: 255 }, whiteBgTolerance, whiteBgEdgeSmoothing, false);
    if (whiteBgFeather > 0) featherAlpha(clone.data, clone.width, clone.height, whiteBgFeather);
    showPreview(clone);
  }, [whiteBgTolerance, whiteBgEdgeSmoothing, whiteBgFeather, showPreview]);

  useEffect(() => {
    if (activeTool === 'white-bg' && imageLoaded) recomputeWhiteBgPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteBgTolerance, whiteBgEdgeSmoothing, whiteBgFeather]);

  const recomputeGreenScreenPreview = useCallback(() => {
    const working = workingCanvasRef.current;
    if (!working) return;
    const ctx = working.getContext('2d')!;
    const data = ctx.getImageData(0, 0, working.width, working.height);
    const clone = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
    chromaKeyGreen(clone.data, clone.width, clone.height, greenTolerance, greenEdgeSmoothing, greenSpillReduction);
    showPreview(clone);
  }, [greenTolerance, greenEdgeSmoothing, greenSpillReduction, showPreview]);

  useEffect(() => {
    if (activeTool === 'green-screen' && imageLoaded) recomputeGreenScreenPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greenTolerance, greenEdgeSmoothing, greenSpillReduction]);

  // Single source of truth for "the active tool just changed": clears any
  // pending preview from the previous tool, then - for tools that preview
  // automatically (no click needed) - computes a fresh one. This must be the
  // ONLY effect keyed on `activeTool` so a stale clear can't run after a
  // fresh preview was just computed by a different effect in the same flush.
  useEffect(() => {
    setMagicClickPoint(null);
    setPendingPreview(null);
    if (activeTool === 'white-bg' && imageLoaded) {
      recomputeWhiteBgPreview();
    } else if (activeTool === 'green-screen' && imageLoaded) {
      recomputeGreenScreenPreview();
    } else {
      redrawDisplay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  const applyPreview = () => {
    if (!pendingPreview) return;
    const working = workingCanvasRef.current;
    if (!working) return;
    working.getContext('2d')!.putImageData(pendingPreview, 0, 0);
    pushHistory(pendingPreview);
    setPendingPreview(null);
    setMagicClickPoint(null);
  };

  const resetPreview = () => {
    setMagicClickPoint(null);
    clearPreview();
  };

  // -------------------------------------------------------------------------
  // Replace Background Color / Background Image
  // -------------------------------------------------------------------------

  const handleBgImageChosen = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      push({ title: 'Unsupported file', description: 'Please choose an image file.' });
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      setBgImageEl(img);
      setBgFillMode('image');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      push({ title: 'Could not load background image', description: 'Please try a different file.' });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // Bakes the currently-composited background (solid/gradient/image) into the
  // working canvas permanently - after this, the layer is opaque there and
  // the change is undoable like any other edit.
  const applyBackgroundFlatten = () => {
    const working = workingCanvasRef.current;
    const display = displayCanvasRef.current;
    if (!working || !display || bgFillMode === 'none') return;
    const wCtx = working.getContext('2d')!;
    wCtx.clearRect(0, 0, working.width, working.height);
    wCtx.drawImage(display, 0, 0);
    const data = wCtx.getImageData(0, 0, working.width, working.height);
    pushHistory(data);
    setBgFillMode('none');
  };

  // -------------------------------------------------------------------------
  // Export - reuses the existing Image Toolkit upload/process/download API:
  // the canvas result is exported as a lossless PNG (preserving whatever
  // transparency/edits were made), then sharp on the server re-encodes it to
  // the chosen format/quality. This also means the export shows up in the
  // normal Image Toolkit job history, with the same auto-expiring download link.
  // -------------------------------------------------------------------------

  const handleExport = async () => {
    const display = displayCanvasRef.current;
    if (!display) return;
    setIsExporting(true);
    try {
      const blob: Blob | null = await new Promise((resolve) => display.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not read the edited image from the canvas.');

      const baseName = (sourceFile?.name || 'background-edit').replace(/\.[^.]+$/, '');
      const formData = new FormData();
      formData.append('file', blob, `${baseName}.png`);

      const uploadRes = await fetch(`${apiBase}/api/image/upload`, {
        method: 'POST',
        headers: { ...authHeaders },
        body: formData,
        credentials: 'include',
      });
      const uploadBody = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) throw new Error(uploadBody?.error || 'Upload failed.');

      const processRes = await fetch(`${apiBase}/api/image/process`, {
        method: 'POST',
        headers: { ...authHeaders },
        body: (() => {
          const fd = new FormData();
          fd.append('jobId', uploadBody.id);
          fd.append('outputFormat', exportFormat);
          fd.append('quality', String(exportQuality));
          fd.append('preserveMetadata', String(preserveMetadata));
          return fd;
        })(),
        credentials: 'include',
      });
      const processBody = await processRes.json().catch(() => null);
      if (!processRes.ok) throw new Error(processBody?.error || 'Export failed.');

      const downloadRes = await fetch(`${apiBase}/api/image/download/${processBody.id}`, {
        headers: { ...authHeaders },
        credentials: 'include',
      });
      const downloadBody = await downloadRes.json().catch(() => null);
      if (!downloadRes.ok || !downloadBody?.url) throw new Error(downloadBody?.error || 'Could not prepare the download.');

      const a = document.createElement('a');
      a.href = downloadBody.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      push({ title: 'Export complete', description: `${baseName}.${exportFormat} is ready.` });
    } catch (err: any) {
      push({ title: 'Export failed', description: err.message || 'Something went wrong.' });
    } finally {
      setIsExporting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Coordinate mapping: screen (pointer event) -> canvas-native pixel space
  // -------------------------------------------------------------------------

  const screenToCanvas = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const display = displayCanvasRef.current;
    if (!display) return null;
    const rect = display.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * display.width;
    const y = ((clientY - rect.top) / rect.height) * display.height;
    return { x, y };
  };

  // -------------------------------------------------------------------------
  // Manual Eraser (brush)
  // -------------------------------------------------------------------------

  const drawBrushSegment = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const working = workingCanvasRef.current;
    if (!working) return;
    const ctx = working.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, working.width, working.height);
    const radius = brushSize / 2;

    if (!from) {
      eraseBrushDab(imageData.data, working.width, working.height, to.x, to.y, radius, brushHardness, brushOpacity);
    } else {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = Math.max(1, radius / 4);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        eraseBrushDab(imageData.data, working.width, working.height, from.x + dx * t, from.y + dy * t, radius, brushHardness, brushOpacity);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    redrawDisplay();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imageLoaded) return;
    if (activeTool === 'hand') {
      isPanningRef.current = true;
      lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (activeTool === 'magic') {
      const point = screenToCanvas(e.clientX, e.clientY);
      if (point) setMagicClickPoint(point);
      return;
    }
    if (activeTool !== 'brush') return;
    const point = screenToCanvas(e.clientX, e.clientY);
    if (!point) return;
    isDrawingRef.current = true;
    strokeStartedRef.current = true;
    lastDrawPointRef.current = point;
    drawBrushSegment(null, point);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - lastPanPointRef.current.x;
      const dy = e.clientY - lastPanPointRef.current.y;
      lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (!isDrawingRef.current || activeTool !== 'brush') return;
    const point = screenToCanvas(e.clientX, e.clientY);
    if (!point) return;
    drawBrushSegment(lastDrawPointRef.current, point);
    lastDrawPointRef.current = point;
  };

  const handlePointerUp = () => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      lastDrawPointRef.current = null;
      if (strokeStartedRef.current) {
        strokeStartedRef.current = false;
        commitWorkingCanvas();
      }
    }
  };

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  const zoomIn = () => setZoom((z) => Math.min(8, z * 1.25));
  const zoomOut = () => setZoom((z) => Math.max(0.1, z / 1.25));
  const zoomReset = () => { setZoom(computeFitZoom()); setPan({ x: 0, y: 0 }); };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!imageLoaded) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  if (!imageLoaded) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Background Editor</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            Erase, key out, or replace an image's background - entirely in your browser, no AI required.
          </p>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files?.length) handleFilesChosen(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-[1.5rem] border-2 border-dashed p-16 text-center transition',
            isDraggingOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-[var(--border)]',
          )}
        >
          <UploadCloud className="h-10 w-10 text-[var(--text-secondary)]" />
          <p className="text-sm font-medium text-[var(--text-primary)]">Drag and drop an image here</p>
          <p className="text-xs text-[var(--text-muted)]">PNG, JPG, WEBP</p>
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Browse files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFilesChosen(e.target.files)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Background Editor</h1>
          <p className="text-sm text-[var(--text-muted)]">{sourceFile?.name} · {imageDims.width}×{imageDims.height}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { setImageLoaded(false); resetToolState(); }}>
          <X className="mr-2 h-4 w-4" /> Start over
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[64px_1fr_280px]">
        {/* Left toolbar */}
        <div className="flex flex-row gap-2 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 lg:flex-col lg:overflow-visible">
          {([
            { id: 'brush', icon: Eraser, label: 'Brush' },
            { id: 'magic', icon: Wand2, label: 'Magic Eraser' },
            { id: 'white-bg', icon: Droplet, label: 'White BG' },
            { id: 'green-screen', icon: Palette, label: 'Green Screen' },
            { id: 'bg-color', icon: PaintBucket, label: 'Background Color' },
            { id: 'bg-image', icon: ImagePlus, label: 'Background Image' },
            { id: 'hand', icon: Hand, label: 'Hand Tool' },
          ] as { id: ToolId; icon: typeof Eraser; label: string }[]).map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.label}
              onClick={() => setActiveTool(tool.id)}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition',
                activeTool === tool.id
                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                  : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface)]',
              )}
            >
              <tool.icon className="h-5 w-5" />
            </button>
          ))}
          <div className="my-1 h-px w-4 shrink-0 bg-[var(--border)] lg:mx-1 lg:h-auto lg:w-px" />
          <button type="button" title="Zoom in" onClick={zoomIn} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--surface)]">
            <ZoomIn className="h-5 w-5" />
          </button>
          <button type="button" title="Zoom out" onClick={zoomOut} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--surface)]">
            <ZoomOut className="h-5 w-5" />
          </button>
          <button type="button" title="Undo" disabled={!canUndo} onClick={handleUndo} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--surface)] disabled:opacity-30">
            <Undo2 className="h-5 w-5" />
          </button>
          <button type="button" title="Redo" disabled={!canRedo} onClick={handleRedo} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--surface)] disabled:opacity-30">
            <Redo2 className="h-5 w-5" />
          </button>
        </div>

        {/* Canvas viewport */}
        <div className="flex min-w-0 flex-col gap-2">
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            className="relative flex h-[600px] w-full min-w-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
            style={{
              cursor: activeTool === 'hand' ? 'grab' : activeTool === 'brush' ? 'crosshair' : activeTool === 'magic' ? 'copy' : 'default',
              backgroundImage:
                'linear-gradient(45deg, rgba(128,128,128,0.15) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.15) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.15) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.15) 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            }}
          >
            <canvas
              ref={displayCanvasRef}
              style={{
                width: Math.max(1, Math.round(imageDims.width * zoom)),
                height: Math.max(1, Math.round(imageDims.height * zoom)),
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
              className="pointer-events-none flex-shrink-0"
            />
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-xs text-[var(--text-muted)]">
            <span>Zoom {Math.round(zoom * 100)}%</span>
            <button type="button" onClick={zoomReset} className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <RotateCcw className="h-3 w-3" /> Reset view
            </button>
            <span>{imageDims.width} × {imageDims.height}px</span>
          </div>
        </div>

        {/* Right settings panel */}
        <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
          {activeTool === 'brush' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Brush</p>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Size: {brushSize}px
                <input type="range" min={2} max={300} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Hardness: {brushHardness}%
                <input type="range" min={0} max={100} value={brushHardness} onChange={(e) => setBrushHardness(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Opacity: {brushOpacity}%
                <input type="range" min={1} max={100} value={brushOpacity} onChange={(e) => setBrushOpacity(Number(e.target.value))} className="w-full" />
              </label>
              <p className="text-xs text-[var(--text-muted)]">Click and drag on the image to erase.</p>
            </div>
          )}

          {activeTool === 'magic' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Magic Color Eraser</p>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Tolerance: {magicTolerance}%
                <input type="range" min={0} max={100} value={magicTolerance} onChange={(e) => setMagicTolerance(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Edge softness: {magicEdgeSoftness}%
                <input type="range" min={0} max={100} value={magicEdgeSoftness} onChange={(e) => setMagicEdgeSoftness(Number(e.target.value))} className="w-full" />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input type="checkbox" checked={magicContiguous} onChange={(e) => setMagicContiguous(e.target.checked)} />
                Contiguous (only connected pixels)
              </label>
              <p className="text-xs text-[var(--text-muted)]">
                {magicClickPoint ? 'Adjust settings or click elsewhere to resample.' : 'Click a color on the image to preview removing it.'}
              </p>
              <PreviewApplyBar visible={!!pendingPreview} onApply={applyPreview} onReset={resetPreview} />
            </div>
          )}

          {activeTool === 'white-bg' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">White Background Remover</p>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Tolerance: {whiteBgTolerance}%
                <input type="range" min={0} max={100} value={whiteBgTolerance} onChange={(e) => setWhiteBgTolerance(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Edge smoothing: {whiteBgEdgeSmoothing}%
                <input type="range" min={0} max={100} value={whiteBgEdgeSmoothing} onChange={(e) => setWhiteBgEdgeSmoothing(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Feather: {whiteBgFeather}px
                <input type="range" min={0} max={20} value={whiteBgFeather} onChange={(e) => setWhiteBgFeather(Number(e.target.value))} className="w-full" />
              </label>
              <p className="text-xs text-[var(--text-muted)]">One-click removal of near-white backgrounds. Preview updates live.</p>
              <PreviewApplyBar visible={!!pendingPreview} onApply={applyPreview} onReset={resetPreview} />
            </div>
          )}

          {activeTool === 'green-screen' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Green Screen</p>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Tolerance: {greenTolerance}%
                <input type="range" min={0} max={100} value={greenTolerance} onChange={(e) => setGreenTolerance(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Edge smoothing: {greenEdgeSmoothing}%
                <input type="range" min={0} max={100} value={greenEdgeSmoothing} onChange={(e) => setGreenEdgeSmoothing(Number(e.target.value))} className="w-full" />
              </label>
              <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                Spill reduction: {greenSpillReduction}%
                <input type="range" min={0} max={100} value={greenSpillReduction} onChange={(e) => setGreenSpillReduction(Number(e.target.value))} className="w-full" />
              </label>
              <p className="text-xs text-[var(--text-muted)]">Removes a green backdrop and tones down green tint bleeding onto the subject's edges.</p>
              <PreviewApplyBar visible={!!pendingPreview} onApply={applyPreview} onReset={resetPreview} />
            </div>
          )}

          {activeTool === 'bg-color' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Replace Background Color</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'none', label: 'Transparent' },
                  { id: 'white', label: 'White' },
                  { id: 'black', label: 'Black' },
                  { id: 'custom', label: 'Custom' },
                  { id: 'gradient', label: 'Gradient' },
                ] as { id: BgFillMode; label: string }[]).map((opt) => (
                  <Button
                    key={opt.id}
                    type="button"
                    size="sm"
                    variant={bgFillMode === opt.id ? 'default' : 'outline'}
                    onClick={() => setBgFillMode(opt.id)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              {bgFillMode === 'custom' && (
                <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                  Color
                  <input type="color" value={bgCustomColor} onChange={(e) => setBgCustomColor(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-transparent" />
                </label>
              )}
              {bgFillMode === 'gradient' && (
                <div className="space-y-2">
                  <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                    From
                    <input type="color" value={bgGradientFrom} onChange={(e) => setBgGradientFrom(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-transparent" />
                  </label>
                  <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                    To
                    <input type="color" value={bgGradientTo} onChange={(e) => setBgGradientTo(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-transparent" />
                  </label>
                  <label className="block space-y-1 text-xs text-[var(--text-muted)]">
                    Angle: {bgGradientAngle}°
                    <input type="range" min={0} max={360} value={bgGradientAngle} onChange={(e) => setBgGradientAngle(Number(e.target.value))} className="w-full" />
                  </label>
                </div>
              )}
              <p className="text-xs text-[var(--text-muted)]">Preview updates live. Apply to bake it in permanently, or leave as-is and it'll be used when you export.</p>
              {bgFillMode !== 'none' && (
                <Button type="button" size="sm" onClick={applyBackgroundFlatten}><Check className="mr-2 h-4 w-4" /> Apply (flatten)</Button>
              )}
            </div>
          )}

          {activeTool === 'bg-image' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Background Image</p>
              <Button type="button" variant="outline" size="sm" onClick={() => bgImageInputRef.current?.click()}>
                <UploadCloud className="mr-2 h-4 w-4" /> {bgImageEl ? 'Change image' : 'Upload image'}
              </Button>
              <input
                ref={bgImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleBgImageChosen(e.target.files)}
              />
              {bgImageEl && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'cover', label: 'Cover' },
                      { id: 'contain', label: 'Contain' },
                      { id: 'stretch', label: 'Stretch' },
                      { id: 'center', label: 'Center' },
                    ] as { id: BgImageFit; label: string }[]).map((opt) => (
                      <Button
                        key={opt.id}
                        type="button"
                        size="sm"
                        variant={bgImageFit === opt.id ? 'default' : 'outline'}
                        onClick={() => setBgImageFit(opt.id)}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">Preview updates live. Apply to bake it in permanently.</p>
                  <Button type="button" size="sm" onClick={applyBackgroundFlatten}><Check className="mr-2 h-4 w-4" /> Apply (flatten)</Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: resolution, size, export */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
          <span>Zoom {Math.round(zoom * 100)}%</span>
          <span>Resolution {imageDims.width} × {imageDims.height}px</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            {(['png', 'jpeg', 'webp'] as ExportFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setExportFormat(fmt)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium uppercase transition',
                  exportFormat === fmt ? 'bg-blue-500/20 text-blue-300' : 'text-[var(--text-secondary)] hover:bg-[var(--panel-bg)]',
                )}
              >
                {fmt}
              </button>
            ))}
          </div>
          {exportFormat !== 'png' && (
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              Quality
              <input type="range" min={10} max={100} value={exportQuality} onChange={(e) => setExportQuality(Number(e.target.value))} className="w-24" />
              <span className="w-8 text-right">{exportQuality}</span>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={preserveMetadata} onChange={(e) => setPreserveMetadata(e.target.checked)} />
            Preserve metadata
          </label>
          <Button type="button" onClick={handleExport} disabled={isExporting}>
            {isExporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting…</> : <><Download className="mr-2 h-4 w-4" /> Export</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
