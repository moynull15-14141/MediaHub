import { Request, Response } from 'express';
import { extractMetadata, getDownloadHistory, saveToHistory, normalizeUrl, getUserCookiePathFromToken } from '../services/media.service';
import youtubedl from 'youtube-dl-exec';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const getClientIp = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
};

const getDeviceInfo = (req: Request) => {
  const ua = String(req.headers['user-agent'] || '');
  const lower = ua.toLowerCase();
  if (/mobile|iphone|ipod|android/i.test(lower)) return { deviceType: 'Mobile', platform: /iphone|ipad|ipod/i.test(lower) ? 'iOS' : 'Android' };
  if (/tablet/i.test(lower)) return { deviceType: 'Tablet', platform: /ipad/i.test(lower) ? 'iOS' : 'Tablet' };
  if (/windows/i.test(lower)) return { deviceType: 'Desktop', platform: 'Windows' };
  if (/macintosh|mac os x/i.test(lower)) return { deviceType: 'Desktop', platform: 'Mac' };
  if (/linux/i.test(lower)) return { deviceType: 'Desktop', platform: 'Linux' };
  return { deviceType: 'Desktop', platform: 'Unknown' };
};

const buildYtdlpDownloadOptions = (token?: string) => {
  const cookiePath = getUserCookiePathFromToken(token);
  const options: Record<string, any> = {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    jsRuntimes: 'node',
    quiet: true,
    preferFreeFormats: true,
    addHeader: [
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language: en-US,en;q=0.9',
      'Referer: https://www.youtube.com/',
    ],
    'extractor-args': 'youtube:player_client=desktop',
  };

  if (cookiePath) {
    options.cookies = cookiePath;
  }

  return options;
};

const runYtdlp = async (url: string, options: Record<string, any>, token?: string) => {
  const normalized = normalizeUrl(url);
  console.log('Running youtube-dl-exec with url:', normalized, 'options:', options, 'tokenPresent:', Boolean(token));
  await youtubedl(normalized, {
    ...buildYtdlpDownloadOptions(token),
    ...options,
  });
};

export const analyzeMedia = async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const authToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const metadata = await extractMetadata(url, authToken);
    const clientIp = getClientIp(req);
    const { deviceType, platform } = getDeviceInfo(req);

    if (metadata) {
      saveToHistory({
        id: crypto.randomUUID(),
        url,
        title: metadata.title,
        status: 'completed',
        date: new Date().toISOString(),
        clientIp,
        device: deviceType,
        platform,
      });
      return res.json(metadata);
    }
    
    res.status(404).json({ error: 'Could not extract media metadata' });
  } catch (error: any) {
    console.error('Analyze exception:', error);
    res.status(500).json({ error: error.stderr || error.message || 'Internal server error during analysis' });
  }
};

export const getHistory = (req: Request, res: Response) => {
  try {
    const history = getDownloadHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error retrieving history' });
  }
};

export const downloadAudio = async (req: Request, res: Response) => {
  const url = req.query.url as string;
  const authToken = (req.query.authToken as string) || undefined;
  const title = (req.query.title as string) || 'download';
  const ext = ((req.query.ext as string) || 'mp3').toLowerCase();

  if (!url) {
    return res.status(400).json({ error: 'URL is required for audio download' });
  }

  const jobDir = path.join(os.tmpdir(), 'mediahub-downloads', crypto.randomUUID());
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'download';
    const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];
    const outputExt = audioExtensions.includes(ext) ? ext : 'mp3';
    const filename = `${safeTitle}.${outputExt}`;
    const outputPath = path.join(jobDir, filename);

    const options: Record<string, any> = {
      output: outputPath,
      format: 'bestaudio',
      extractAudio: true,
      audioFormat: outputExt,
      audioQuality: '192K',
      forceOverwrites: true,
    };

    await runYtdlp(url, options, authToken);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Downloaded file missing after yt-dlp finished');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('Audio download response error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send downloaded audio file' });
        }
      }
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
    });
  } catch (error: any) {
    console.error('Audio download exception:', error);
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: error.stderr || error.message || 'Internal server error during audio download' });
    }
  }
};

export const downloadMedia = async (req: Request, res: Response) => {
  const url = req.query.url as string;
  const authToken = (req.query.authToken as string) || undefined;
  const formatId = (req.query.formatId as string) || 'best';
  const formatType = (req.query.formatType as string) || 'video';
  const formatHasAudio = req.query.formatHasAudio === 'true';
  const title = (req.query.title as string) || 'download';
  const ext = (req.query.ext as string) || 'mp4';

  if (!url) {
    return res.status(400).json({ error: 'URL is required for download' });
  }

  // Each request gets its own temp folder so retries never reuse a stale
  // file from a previous (possibly failed) attempt for the same title.
  const jobDir = path.join(os.tmpdir(), 'mediahub-downloads', crypto.randomUUID());
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'download';
    const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];
    const isAudioOnly = formatType === 'audio';
    const outputExt = isAudioOnly ? (audioExtensions.includes(ext) ? ext : 'mp3') : ext;
    const filename = `${safeTitle}.${outputExt}`;
    const outputPath = path.join(jobDir, filename);
    const formatArg = formatId || 'best';

    // Anything that isn't audio-only and doesn't already carry an audio
    // track needs to be merged with the best available audio. Let yt-dlp
    // (backed by ffmpeg) do that merge itself instead of hand-rolling it -
    // it reliably picks a compatible audio codec for the target container.
    const needsAudioMerge = !isAudioOnly && !formatHasAudio;
    const selectedFormat = isAudioOnly
      ? (formatArg === 'best' ? 'bestaudio' : formatArg)
      : needsAudioMerge
      ? (formatArg === 'best' ? 'bestvideo+bestaudio/best' : `${formatArg}+bestaudio/best`)
      : formatArg;

    const options: Record<string, any> = {
      output: outputPath,
      format: selectedFormat,
      forceOverwrites: true,
      ...(isAudioOnly
        ? { extractAudio: true, audioFormat: outputExt, audioQuality: '192K' }
        : { mergeOutputFormat: outputExt }),
    };

    await runYtdlp(url, options, authToken);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Downloaded file missing after yt-dlp finished');
    }

    res.setHeader('Content-Type', isAudioOnly ? 'audio/mpeg' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('Download response error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send downloaded file' });
        }
      }
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
    });
  } catch (error: any) {
    console.error('Download exception:', error);
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: error.stderr || error.message || 'Internal server error during download' });
    }
  }
};
