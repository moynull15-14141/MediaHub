import { Request, Response } from 'express';
import { extractMetadata, getDownloadHistory, saveToHistory } from '../services/media.service';
import youtubedl from 'youtube-dl-exec';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const buildYtdlpDownloadOptions = () => {
  const cookiePath = process.env.YOUTUBE_COOKIES_FILE;
  const options: Record<string, any> = {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    jsRuntimes: 'node',
    quiet: true,
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

const normalizeUrl = (url: string) => {
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
    // Keep original if normalization fails.
  }
  return url;
};

const runYtdlp = async (url: string, options: Record<string, any>) => {
  const normalized = normalizeUrl(url);
  console.log('Running youtube-dl-exec with url:', normalized, 'options:', options);
  await youtubedl(normalized, {
    ...buildYtdlpDownloadOptions(),
    ...options,
  });
};

export const analyzeMedia = async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const metadata = await extractMetadata(url);
    
    if (metadata) {
      saveToHistory({
        id: crypto.randomUUID(),
        url,
        title: metadata.title,
        status: 'completed',
        date: new Date().toISOString()
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
  const title = (req.query.title as string) || 'download';
  const ext = ((req.query.ext as string) || 'mp3').toLowerCase();

  if (!url) {
    return res.status(400).json({ error: 'URL is required for audio download' });
  }

  const tempDir = path.join(os.tmpdir(), 'mediahub-downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];
    const outputExt = audioExtensions.includes(ext) ? ext : 'mp3';
    const filename = `${safeTitle}.${outputExt}`;
    const outputPath = path.join(tempDir, filename);

    const options: Record<string, any> = {
      output: outputPath,
      format: 'bestaudio',
      extractAudio: true,
      audioFormat: outputExt,
      audioQuality: '192K',
    };

    await runYtdlp(url, options);

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
      fs.unlink(outputPath, () => {});
    });
  } catch (error: any) {
    console.error('Audio download exception:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.stderr || error.message || 'Internal server error during audio download' });
    }
  }
};

export const downloadMedia = async (req: Request, res: Response) => {
  const url = req.query.url as string;
  const formatId = (req.query.formatId as string) || 'best';
  const formatType = (req.query.formatType as string) || 'video';
  const formatHasVideo = req.query.formatHasVideo === 'true';
  const formatHasAudio = req.query.formatHasAudio === 'true';
  const title = (req.query.title as string) || 'download';
  const ext = (req.query.ext as string) || 'mp4';

  if (!url) {
    return res.status(400).json({ error: 'URL is required for download' });
  }

  const tempDir = path.join(os.tmpdir(), 'mediahub-downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    const audioExtensions = ['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac'];
    const isAudioOnly = formatType === 'audio';
    const outputExt = isAudioOnly ? (audioExtensions.includes(ext) ? ext : 'mp3') : ext;
    const filename = `${safeTitle}.${outputExt}`;
    const outputPath = path.join(tempDir, filename);
    const formatArg = formatId || 'best';

    const options: Record<string, any> = {
      output: outputPath,
      format: isAudioOnly ? (formatArg === 'best' ? 'bestaudio' : formatArg) : (formatArg === 'best' ? 'bestvideo+bestaudio/best' : formatArg),
      mergeOutputFormat: isAudioOnly ? undefined : outputExt,
      extractAudio: isAudioOnly,
      audioFormat: isAudioOnly ? outputExt : undefined,
      audioQuality: isAudioOnly ? '192K' : undefined,
    };

    await runYtdlp(url, options);

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
      fs.unlink(outputPath, () => {});
    });
  } catch (error: any) {
    console.error('Download exception:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.stderr || error.message || 'Internal server error during download' });
    }
  }
};
