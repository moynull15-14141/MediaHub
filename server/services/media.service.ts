import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Simulated DB for Prototype
const historyStore: any[] = [];

const runYtdlpJson = (url: string) => {
  return new Promise<any>((resolve, reject) => {
    const ytdlpBinary = process.env.YTDLP_PATH || 'yt-dlp';
    const args = [
      '--dump-single-json',
      '--no-warnings',
      '--no-check-certificate',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      url,
    ];

    const subprocess = spawn(ytdlpBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    subprocess.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    subprocess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    subprocess.on('error', (error) => reject(error));

    subprocess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse yt-dlp output: ${error instanceof Error ? error.message : String(error)}\n${stderr}`));
      }
    });
  });
};

export interface MediaMetadata {
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
  fileSize: string;
  formats: {
    formatId: string;
    quality: string;
    ext: string;
    size: string;
    type: 'video' | 'audio';
    hasVideo: boolean;
    hasAudio: boolean;
    height?: number;
    abr?: number;
  }[];
}

const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds: number) {
  if (!seconds) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const extractMetadata = async (url: string): Promise<MediaMetadata | null> => {
  try {
    const isDirectFile = url.match(/\.(mp4|mp3|webm|m4a|ogg|mov|avi|mkv|wav|aac|flac)$/i);
    
    if (isDirectFile) {
      const ext = url.split('.').pop()?.toLowerCase() || 'unknown';
      const isAudioDirect = audioExtensions.includes(ext);
      return {
        title: `Direct Media File (${ext.toUpperCase()})`,
        thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&q=80',
        duration: 'Unknown',
        author: 'Direct Source',
        fileSize: 'Unknown',
        formats: [
          {
            formatId: 'best',
            quality: 'Source',
            ext,
            size: 'Original',
            type: isAudioDirect ? 'audio' : 'video',
            hasVideo: !isAudioDirect,
            hasAudio: true,
          },
        ],
      };
    }

    console.log('Attempting to extract metadata for:', url);
    const output: any = await runYtdlpJson(url);
    console.log('Metadata extraction successful:', output.title);
    
    // Process formats
    let formats = (output.formats || [])
      .filter((f: any) => f.vcodec !== 'none' || f.acodec !== 'none')
      .map((f: any) => {
        const hasVideo = !!f.vcodec && f.vcodec !== 'none';
        const hasAudio = !!f.acodec && f.acodec !== 'none';
        const type = hasVideo ? 'video' : 'audio';
        const height = typeof f.height === 'number' ? f.height : undefined;
        const abr = typeof f.abr === 'number' ? Math.round(f.abr) : undefined;
        const quality = hasVideo
          ? (f.resolution || (height ? `${height}p` : 'Unknown'))
          : (abr ? `${abr}kbps` : 'Audio');
        const size = f.filesize
          ? formatBytes(f.filesize)
          : f.filesize_approx
            ? formatBytes(f.filesize_approx)
            : 'Unknown';

        return {
          formatId: f.format_id,
          quality,
          ext: f.ext,
          size,
          type,
          hasVideo,
          hasAudio,
          height,
          abr,
        };
      })
      .filter((f: any) => f.formatId && f.quality !== 'Unknown');

    formats.sort((a: any, b: any) => {
      if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
      const scoreA = a.type === 'video'
        ? (a.height || parseInt(a.quality) || 0)
        : (a.abr || parseInt(a.quality) || 0);
      const scoreB = b.type === 'video'
        ? (b.height || parseInt(b.quality) || 0)
        : (b.abr || parseInt(b.quality) || 0);
      if (scoreA !== scoreB) return scoreB - scoreA;
      if (a.hasVideo !== b.hasVideo) return a.hasVideo ? -1 : 1;
      return 0;
    });

    const uniqueMap = new Map<string, any>();
    formats.forEach((format) => {
      if (!uniqueMap.has(format.formatId)) {
        uniqueMap.set(format.formatId, format);
      }
    });
    const uniqueFormats = Array.from(uniqueMap.values()) as MediaMetadata['formats'];

    if (uniqueFormats.length === 0) {
      uniqueFormats.push({
        formatId: 'best',
        quality: 'Best available',
        ext: output.ext || 'mp4',
        size: 'Unknown',
        type: 'video',
        hasVideo: true,
        hasAudio: true,
      });
    }

    const limitedFormats = uniqueFormats.slice(0, 60);

    return {
      title: output.title || 'Unknown Title',
      thumbnail: output.thumbnail || 'https://images.unsplash.com/photo-1578022761797-b8636ac1773c?w=800&q=80',
      duration: formatDuration(output.duration),
      author: output.uploader || output.channel || output.extractor || 'Unknown',
      fileSize: formatBytes(output.filesize || output.filesize_approx || 0) || 'Unknown',
      formats: uniqueFormats
    };
  } catch (e: any) {
    console.error('Extraction error:', e);
    console.error('Error details:', {
      message: e.message,
      code: e.code,
      stderr: e.stderr,
      stdout: e.stdout
    });
    throw e;
  }
};

export const saveToHistory = (record: any) => {
  historyStore.unshift(record);
  if (historyStore.length > 100) historyStore.pop();
};

export const getDownloadHistory = () => {
  return historyStore;
};
