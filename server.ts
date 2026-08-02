import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import mediaRoutes from './server/routes/media.routes';
import authRoutes from './server/routes/auth.routes';
import converterRoutes from './server/routes/converter.routes';
import imageRoutes from './server/routes/image.routes';
import pdfRoutes from './server/routes/pdf.routes';
import whatsappRoutes from './server/routes/whatsapp.routes';
import { startConverterCleanupScheduler } from './server/services/converter-cleanup.service';
import { startImageCleanupScheduler } from './server/services/image-cleanup.service';
import { startPdfCleanupScheduler } from './server/services/pdf-cleanup.service';
import { startCampaignQueueWorker, stopCampaignQueueWorker } from './server/services/campaign-queue-worker.service';
import { startReportScheduler, stopReportScheduler } from './server/services/report-scheduler.service';
import { webhookVerifyHandler, webhookReceiveHandler } from './server/controllers/campaign-webhook.controller';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Meta's webhook signature check needs the raw request body, which the
  // default JSON parsing discards - stash it alongside the parsed body.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
  );

  // CORS support for a frontend deployed on a different origin (e.g. Vercel).
  // The origin is reflected (rather than '*') and credentials are allowed so
  // the anonymous-history cookie can be set/read across origins.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    // Content-Disposition isn't on the CORS response-header safelist, so
    // without this, cross-origin fetch() can't read the filename we set,
    // and downloads fall back to a generic extension-less name in the browser.
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Meta calls these directly (no Authorization header it could send), so
  // they're intentionally outside the authenticated whatsapp router. Must be
  // registered before that router is mounted below - otherwise the router's
  // internal router.use(requireAuth) (a path-less middleware that runs for
  // every /api/whatsapp/* request it receives, matched or not) would 401
  // this request before Express ever got a chance to fall through to these.
  app.get('/api/whatsapp/webhook', webhookVerifyHandler);
  app.post('/api/whatsapp/webhook', webhookReceiveHandler);

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/converter', converterRoutes);
  app.use('/api/image', imageRoutes);
  app.use('/api/pdf', pdfRoutes);
  app.use('/api/whatsapp', whatsappRoutes);

  startConverterCleanupScheduler();
  startImageCleanupScheduler();
  startPdfCleanupScheduler();
  startCampaignQueueWorker();
  startReportScheduler();

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise MediaHub Server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down gracefully...`);
    await stopCampaignQueueWorker();
    await stopReportScheduler();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer();
