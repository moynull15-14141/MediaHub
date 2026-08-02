import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findUserById, verifyAuthToken } from './user.service';
import { RequestOwner, ownerMatches } from '../lib/auth-helpers';

// Simulated DB for Prototype
const historyStore: any[] = [];

export const normalizeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) {
        const videoId = parsed.pathname.split('/')[2];
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
    }
    if (parsed.hostname === 'youtu.be') {
      const videoId = parsed.pathname.slice(1);
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
  } catch {
    // Keep original URL if normalization fails.
  }
  return url;
};

export const getYouTubeCookiePath = () => {
  const cookiePath = process.env.YOUTUBE_COOKIES_FILE;
  const rawCookieData = process.env.YOUTUBE_COOKIES;

  if (cookiePath && fs.existsSync(cookiePath)) {
    return cookiePath;
  }

  if (cookiePath) {
    console.warn('YOUTUBE_COOKIES_FILE is set but file does not exist:', cookiePath);
  }

  if (rawCookieData) {
    const tempPath = path.join(os.tmpdir(), 'mediahub-youtube-cookies.txt');
    fs.writeFileSync(tempPath, rawCookieData, 'utf8');
    return tempPath;
  }

  return undefined;
};

export const getUserCookiePathFromToken = async (token?: string) => {
  if (!token) return undefined;
  const payload = verifyAuthToken(token);
  if (!payload) return undefined;
  const user = await findUserById(payload.sub);
  if (!user) return undefined;
  return user.cookiePath ?? undefined;
};

const buildYtdlpOptions = (cookiePath?: string) => {
  const options: Record<string, any> = {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    preferFreeFormats: true,
    jsRuntimes: 'node',
    quiet: true,
    addHeader: [
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language: en-US,en;q=0.9',
      'Referer: https://www.youtube.com/',
    ],
    'extractor-args': 'youtube:player_client=desktop',
  };

  const resolvedCookiePath = cookiePath || getYouTubeCookiePath();
  if (resolvedCookiePath) {
    options.cookies = resolvedCookiePath;
  }

  return options;
};

const runYtdlpJson = (url: string, cookiePath?: string) => {
  return youtubedl(normalizeUrl(url), buildYtdlpOptions(cookiePath));
};

export const runYtdlp = async (url: string, options: Record<string, any>, cookiePath?: string) => {
  return youtubedl(normalizeUrl(url), {
    ...buildYtdlpOptions(cookiePath),
    ...options,
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
    type: 'video' | 'audio' | 'image';
    hasVideo: boolean;
    hasAudio: boolean;
    height?: number;
    abr?: number;
  }[];
}

const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];
const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

export const resolveDirectMediaUrl = async (url: string, cookiePath?: string): Promise<string | undefined> => {
  const output: any = await runYtdlpJson(url, cookiePath);
  return output.url || output.formats?.[output.formats.length - 1]?.url;
};

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

export const extractMetadata = async (url: string, authToken?: string): Promise<MediaMetadata | null> => {
  try {
    const isDirectImage = url.match(/\.(jpe?g|png|gif|webp|bmp|svg)$/i);

    if (isDirectImage) {
      const ext = url.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        title: `Direct Image File (${ext.toUpperCase()})`,
        thumbnail: url,
        duration: 'N/A',
        author: 'Direct Source',
        fileSize: 'Unknown',
        formats: [
          {
            formatId: 'best',
            quality: 'Original',
            ext,
            size: 'Original',
            type: 'image',
            hasVideo: false,
            hasAudio: false,
          },
        ],
      };
    }

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

    const normalizedUrl = normalizeUrl(url);
    if (normalizedUrl !== url) {
      console.log('Normalized YouTube URL:', url, '->', normalizedUrl);
    } else {
      console.log('Attempting to extract metadata for:', url);
    }
    const cookiePath = await getUserCookiePathFromToken(authToken);
    const output: any = await runYtdlpJson(normalizedUrl, cookiePath);
    console.log('Metadata extraction successful:', output.title);

    // Some pages (e.g. a Wikipedia file page) aren't videos at all - yt-dlp's
    // generic extractor just resolves the page's main image. Treat that as
    // an image result instead of forcing it through the video/audio pipeline.
    const resolvedExt = String(output.ext || '').toLowerCase();
    if (imageExtensions.includes(resolvedExt)) {
      return {
        title: output.title || 'Direct Image File',
        thumbnail: output.thumbnail || output.url || normalizedUrl,
        duration: 'N/A',
        author: output.uploader || output.channel || output.extractor || 'Unknown',
        fileSize: formatBytes(output.filesize || output.filesize_approx || 0) === '0 B' ? 'Unknown' : formatBytes(output.filesize || output.filesize_approx || 0),
        formats: [
          {
            formatId: 'best',
            quality: 'Original',
            ext: resolvedExt,
            size: 'Original',
            type: 'image',
            hasVideo: false,
            hasAudio: false,
          },
        ],
      };
    }

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

    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const combined = `${stderr}\n${e.message || ''}`;
    if (stderr.includes('Sign in to confirm you\'re not a bot')) {
      throw new Error('YouTube is blocking this request. Provide valid cookies via YOUTUBE_COOKIES_FILE or use a different video.');
    }
    if (stderr.includes('Video unavailable')) {
      throw new Error('This YouTube video is unavailable or blocked. Verify the URL or try another video.');
    }
    if (stderr.includes('This video is age restricted')) {
      throw new Error('This YouTube video is age restricted and requires authentication/cookies.');
    }
    if (combined.includes('facebook.com/login')) {
      throw new Error('This Facebook content (e.g. a Story) is private and requires you to be logged in. Upload your Facebook browser cookies via "Upload cookies" in the sidebar, or share a public post/video link instead.');
    }

    throw new Error(e.message || 'Unknown extraction error');
  }
};

export const saveToHistory = (record: any, owner: RequestOwner) => {
  historyStore.unshift({ ...record, userId: owner.userId ?? null, anonId: owner.userId ? null : owner.anonId });
  if (historyStore.length > 500) historyStore.pop();
};

export const getDownloadHistory = (owner: RequestOwner) => {
  return historyStore.filter((record) => ownerMatches(record, owner));
};
