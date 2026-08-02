import { Request, Response } from 'express';
import { extractMetadata, getDownloadHistory, saveToHistory, normalizeUrl, getUserCookiePathFromToken, resolveDirectMediaUrl } from '../services/media.service';
import { getRequestOwner } from '../lib/auth-helpers';
import { getClientIp, getDeviceInfo } from '../lib/request-info';
import youtubedl from 'youtube-dl-exec';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const buildYtdlpDownloadOptions = async (token?: string) => {
  const cookiePath = await getUserCookiePathFromToken(token);
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

const friendlyDownloadError = (error: any, fallback: string) => {
  const combined = `${typeof error.stderr === 'string' ? error.stderr : ''}\n${error.message || ''}`;
  if (combined.includes('facebook.com/login')) {
    return 'This Facebook content (e.g. a Story) is private and requires you to be logged in. Upload your Facebook browser cookies via "Upload cookies" in the sidebar, or share a public post/video link instead.';
  }
  return error.stderr || error.message || fallback;
};

const runYtdlp = async (url: string, options: Record<string, any>, token?: string) => {
  const normalized = normalizeUrl(url);
  console.log('Running youtube-dl-exec with url:', normalized, 'options:', options, 'tokenPresent:', Boolean(token));
  await youtubedl(normalized, {
    ...(await buildYtdlpDownloadOptions(token)),
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
      saveToHistory(
        {
          id: crypto.randomUUID(),
          url,
          title: metadata.title,
          status: 'completed',
          date: new Date().toISOString(),
          clientIp,
          device: deviceType,
          platform,
        },
        getRequestOwner(req, res),
      );
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
    const history = getDownloadHistory(getRequestOwner(req, res));
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
    const safeTitle = (title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'download').slice(0, 100).replace(/_+$/g, '') || 'download';
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
      res.status(500).json({ error: friendlyDownloadError(error, 'Internal server error during audio download') });
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

  const imageContentTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };

  try {
    const safeTitle = (title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'download').slice(0, 100).replace(/_+$/g, '') || 'download';
    const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];
    const isAudioOnly = formatType === 'audio';
    const isImage = formatType === 'image';
    const outputExt = isAudioOnly ? (audioExtensions.includes(ext) ? ext : 'mp3') : (isImage ? (imageContentTypes[ext] ? ext : 'jpg') : ext);
    const filename = `${safeTitle}.${outputExt}`;
    const outputPath = path.join(jobDir, filename);
    const formatArg = formatId || 'best';

    if (isImage) {
      // Images aren't yt-dlp's domain - fetch the source file directly. If
      // `url` is a webpage rather than the raw file (e.g. a Wikipedia file
      // page), resolve the actual image URL via yt-dlp's extractor first.
      let imageResponse = await fetch(url);
      const initialContentType = imageResponse.headers.get('content-type') || '';
      if (!imageResponse.ok || !initialContentType.startsWith('image/')) {
        const resolvedUrl = await resolveDirectMediaUrl(url, await getUserCookiePathFromToken(authToken));
        if (!resolvedUrl) {
          throw new Error('Could not resolve a direct image URL from this link');
        }
        imageResponse = await fetch(resolvedUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch resolved image (status ${imageResponse.status})`);
        }
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    } else {
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
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('Downloaded file missing after processing finished');
    }

    res.setHeader('Content-Type', isAudioOnly ? 'audio/mpeg' : isImage ? (imageContentTypes[outputExt] || 'application/octet-stream') : 'application/octet-stream');
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
      res.status(500).json({ error: friendlyDownloadError(error, 'Internal server error during download') });
    }
  }
};
