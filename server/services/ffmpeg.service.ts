import { spawn, execFile, ChildProcess } from 'child_process';

export type OutputFormat = 'mp4' | 'mkv' | 'mov' | 'avi' | 'webm';
export type Quality = 'original' | 'highest' | '1080p' | '720p' | '480p' | '360p';
export type VideoCodec = 'h264' | 'h265' | 'av1' | 'vp9';
export type AudioCodec = 'aac' | 'mp3' | 'opus' | 'copy';
export type AudioMode = 'keep' | 'remove' | 'extract';
export type EncodePreset = 'fast' | 'balanced' | 'high-compression';

export interface ConversionOptions {
  outputFormat: OutputFormat;
  quality: Quality;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  fps: 'keep' | number;
  audioMode: AudioMode;
  preset: EncodePreset;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
}

export interface ProbeResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

const RESOLUTION_HEIGHT: Record<Quality, number | null> = {
  original: null,
  highest: null,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
  '360p': 360,
};

const VIDEO_CODEC_MAP: Record<VideoCodec, { software: string; hwCandidates: string[] }> = {
  h264: { software: 'libx264', hwCandidates: ['h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_videotoolbox'] },
  h265: { software: 'libx265', hwCandidates: ['hevc_nvenc', 'hevc_qsv', 'hevc_vaapi'] },
  av1: { software: 'libsvtav1', hwCandidates: [] },
  vp9: { software: 'libvpx-vp9', hwCandidates: [] },
};

const AUDIO_CODEC_MAP: Record<Exclude<AudioCodec, 'copy'>, string> = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
};

export const AUDIO_EXTRACT_EXTENSION: Record<AudioCodec, string> = {
  aac: '.m4a',
  mp3: '.mp3',
  opus: '.opus',
  copy: '.m4a',
};

const PRESET_SPEED_MAP: Record<EncodePreset, string> = {
  fast: 'veryfast',
  balanced: 'medium',
  'high-compression': 'slow',
};

const PRESET_CRF_MAP: Record<EncodePreset, number> = {
  fast: 26,
  balanced: 23,
  'high-compression': 30,
};

const VP9_DEADLINE_MAP: Record<EncodePreset, string> = {
  fast: 'realtime',
  balanced: 'good',
  'high-compression': 'best',
};

const HW_ENCODER_NAMES = [
  'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_vaapi', 'hevc_vaapi', 'h264_videotoolbox',
];
const AVAILABLE_ENCODER_NAMES = [...HW_ENCODER_NAMES, 'libsvtav1'];

let availableEncodersCache: Set<string> | null = null;

// A hardware encoder can be listed by `ffmpeg -encoders` because ffmpeg was compiled with
// support for it, yet still fail at runtime if there's no matching GPU/driver present
// (e.g. h264_nvenc without an NVIDIA card). Actually test-encode a frame to be sure.
const canActuallyEncode = (encoder: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=64x64:d=0.1', '-c:v', encoder, '-f', 'null', '-'],
      { timeout: 10000 },
      (err) => resolve(!err),
    );
  });

export const detectAvailableEncoders = async (): Promise<Set<string>> => {
  if (availableEncodersCache) return availableEncodersCache;
  const result = new Set<string>();
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 10000, maxBuffer: 10 * 1024 * 1024 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    const compiledIn = AVAILABLE_ENCODER_NAMES.filter((name) => stdout.includes(name));
    for (const name of compiledIn) {
      if (!HW_ENCODER_NAMES.includes(name) || (await canActuallyEncode(name))) {
        result.add(name);
      }
    }
  } catch {
    // ffmpeg missing or the probe failed - treat as "nothing available", never throw.
  }
  availableEncodersCache = result;
  return availableEncodersCache;
};

const normalizeVideoCodec = (raw: string | undefined): string | null => {
  if (!raw) return null;
  if (raw === 'hevc') return 'h265';
  return raw;
};

const normalizeAudioCodec = (raw: string | undefined): string | null => raw || null;

export const probeVideo = (filePath: string): Promise<ProbeResult> =>
  new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error('INVALID_MEDIA_FILE'));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const streams: any[] = parsed.streams || [];
          const videoStream = streams.find((s) => s.codec_type === 'video');
          const audioStream = streams.find((s) => s.codec_type === 'audio');
          if (!videoStream) {
            reject(new Error('NOT_A_VIDEO_FILE'));
            return;
          }
          resolve({
            durationSeconds: parsed.format?.duration ? parseFloat(parsed.format.duration) : null,
            width: videoStream.width ?? null,
            height: videoStream.height ?? null,
            videoCodec: normalizeVideoCodec(videoStream.codec_name),
            audioCodec: normalizeAudioCodec(audioStream?.codec_name),
          });
        } catch {
          reject(new Error('INVALID_MEDIA_FILE'));
        }
      },
    );
  });

const pushVideoArgs = (
  args: string[],
  options: ConversionOptions,
  inputVideoCodec: string | null,
  availableEncoders: Set<string>,
) => {
  const targetHeight = RESOLUTION_HEIGHT[options.quality];
  const needsScale = targetHeight !== null;
  const codecMatchesSource = inputVideoCodec === options.videoCodec;
  const canCopy = !needsScale && options.fps === 'keep' && codecMatchesSource;

  if (canCopy) {
    args.push('-c:v', 'copy');
    return;
  }

  const codecInfo = VIDEO_CODEC_MAP[options.videoCodec];
  let encoder = codecInfo.software;
  for (const hw of codecInfo.hwCandidates) {
    if (availableEncoders.has(hw)) {
      encoder = hw;
      break;
    }
  }
  if (options.videoCodec === 'av1' && !availableEncoders.has('libsvtav1')) {
    encoder = 'libaom-av1';
  }

  args.push('-c:v', encoder);

  if (needsScale) {
    args.push('-vf', `scale=-2:${targetHeight}`);
  }
  if (options.fps !== 'keep') {
    args.push('-r', String(options.fps));
  }

  if (encoder === 'libvpx-vp9') {
    args.push('-deadline', VP9_DEADLINE_MAP[options.preset], '-b:v', '0', '-crf', String(PRESET_CRF_MAP[options.preset]));
  } else if (encoder === 'libaom-av1') {
    args.push('-crf', String(PRESET_CRF_MAP[options.preset]), '-b:v', '0');
  } else if (encoder === 'libx264' || encoder === 'libx265' || encoder === 'libsvtav1') {
    args.push('-preset', PRESET_SPEED_MAP[options.preset], '-crf', String(PRESET_CRF_MAP[options.preset]));
  }
  // Hardware encoders (nvenc/qsv/vaapi) rely on their own sane defaults here;
  // their rate-control flag names differ per vendor and aren't worth the
  // added complexity for a best-effort fallback path that rarely activates.
};

const pushAudioEncodeArgs = (args: string[], audioCodec: AudioCodec, inputAudioCodec: string | null) => {
  if (audioCodec === 'copy' || inputAudioCodec === audioCodec) {
    args.push('-c:a', 'copy');
    return;
  }
  const codec = AUDIO_CODEC_MAP[audioCodec];
  args.push('-c:a', codec);
  args.push('-b:a', audioCodec === 'opus' ? '128k' : '192k');
};

export const buildFfmpegArgs = (params: {
  inputPath: string;
  outputPath: string;
  inputVideoCodec: string | null;
  inputAudioCodec: string | null;
  options: ConversionOptions;
  availableEncoders: Set<string>;
}): string[] => {
  const { inputPath, outputPath, inputVideoCodec, inputAudioCodec, options, availableEncoders } = params;
  const args: string[] = ['-y'];
  if (options.trimStartSeconds) {
    args.push('-ss', String(options.trimStartSeconds));
  }
  args.push('-i', inputPath);
  if (options.trimEndSeconds !== undefined && options.trimEndSeconds > (options.trimStartSeconds || 0)) {
    args.push('-t', String(options.trimEndSeconds - (options.trimStartSeconds || 0)));
  }

  if (options.audioMode === 'extract') {
    args.push('-vn');
    pushAudioEncodeArgs(args, options.audioCodec, inputAudioCodec);
    args.push(outputPath);
    return args;
  }

  pushVideoArgs(args, options, inputVideoCodec, availableEncoders);

  if (options.audioMode === 'remove') {
    args.push('-an');
  } else {
    pushAudioEncodeArgs(args, options.audioCodec, inputAudioCodec);
  }

  args.push(outputPath);
  return args;
};

export interface FfmpegProgressUpdate {
  percent: number | null;
  etaSeconds: number | null;
  speed: number | null;
}

export interface RunFfmpegResult {
  child: ChildProcess;
  done: Promise<{ success: boolean; errorMessage?: string }>;
}

const extractFriendlyFfmpegError = (stderrTail: string): string | undefined => {
  if (stderrTail.includes('No space left on device')) {
    return 'The server ran out of disk space during conversion';
  }
  const lines = stderrTail.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1];
  return lastLine ? lastLine.slice(0, 500) : undefined;
};

export const runFfmpegWithProgress = (
  args: string[],
  durationSeconds: number | null,
  onProgress: (update: FfmpegProgressUpdate) => void,
): RunFfmpegResult => {
  const child = spawn('ffmpeg', [...args, '-progress', 'pipe:1', '-nostats'], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4096);
  });

  let lastEmit = 0;
  let lineBuffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    let outTimeMs: number | null = null;
    let speed: number | null = null;
    let sawEnd = false;
    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key === 'out_time_ms' && value) outTimeMs = Number(value);
      else if (key === 'speed' && value) speed = parseFloat(value);
      else if (key === 'progress' && value?.trim() === 'end') sawEnd = true;
    }

    const now = Date.now();
    if (outTimeMs !== null && (now - lastEmit > 1000 || sawEnd)) {
      lastEmit = now;
      const percent = durationSeconds
        ? Math.min(100, Math.round((outTimeMs / 1000 / durationSeconds) * 100))
        : null;
      const etaSeconds =
        durationSeconds && speed ? Math.max(0, (durationSeconds - outTimeMs / 1000) / speed) : null;
      onProgress({ percent, etaSeconds, speed });
    }
  });

  const done = new Promise<{ success: boolean; errorMessage?: string }>((resolve) => {
    child.on('error', (err) => {
      resolve({ success: false, errorMessage: err.message });
    });
    child.on('close', (code, signal) => {
      if (signal) {
        resolve({ success: false, errorMessage: `Conversion cancelled (${signal})` });
        return;
      }
      if (code === 0) {
        resolve({ success: true });
        return;
      }
      console.error(`ffmpeg exited with code ${code}\nargs: ${args.join(' ')}\nstderr tail:\n${stderrTail}`);
      resolve({ success: false, errorMessage: extractFriendlyFfmpegError(stderrTail) || `ffmpeg exited with code ${code}` });
    });
  });

  return { child, done };
};

export const killGracefully = (child: ChildProcess) => {
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, 3000);
  child.once('exit', () => clearTimeout(timer));
};
