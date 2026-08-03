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
import systemRoutes from './server/routes/system.routes';
import { startConverterCleanupScheduler } from './server/services/converter-cleanup.service';
import { startImageCleanupScheduler } from './server/services/image-cleanup.service';
import { startPdfCleanupScheduler } from './server/services/pdf-cleanup.service';
import { startCampaignQueueWorker, stopCampaignQueueWorker } from './server/services/campaign-queue-worker.service';
import { startReportScheduler, stopReportScheduler } from './server/services/report-scheduler.service';
import { startWhatsappHealthScheduler, stopWhatsappHealthScheduler } from './server/services/whatsapp-health-scheduler.service';
import { webhookVerifyHandler, webhookReceiveHandler } from './server/controllers/campaign-webhook.controller';
import { seedPermissions } from './server/services/permission.service';
import { config } from './server/lib/config';
import { appLogger } from './server/lib/logger';
import { validateEnvironment, validateStartupDependencies } from './server/lib/startup-validation';
import { applySecurityMiddleware } from './server/middleware/security.middleware';
import { errorHandlerMiddleware, notFoundHandler } from './server/middleware/error-handler.middleware';

async function startServer() {
  // Part 7/8: fail fast on genuinely unrecoverable config, warn on the rest.
  validateEnvironment();

  const app = express();
  const PORT = config.port;

  // trust proxy + helmet + compression + general API rate limiting - must be
  // early, before anything reads req.ip or serves a response.
  applySecurityMiddleware(app);

  // Meta's webhook signature check needs the raw request body, which the
  // default JSON parsing discards - stash it alongside the parsed body.
  app.use(
    express.json({
      limit: config.requestBodyLimit,
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
  );

  // CORS support for a frontend deployed on a different origin (e.g. Vercel).
  // The origin is reflected (rather than '*') and credentials are allowed so
  // the anonymous-history cookie can be set/read across origins. Optional
  // allowlist enforcement (config.cors.allowedOrigins) layers on top without
  // changing this default when unset.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token');
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

  // API Routes - mounted at both /api/* (unchanged) and /api/v1/* (Part 10:
  // versioning without breaking anything currently calling /api/*). Same
  // router instances, so there is exactly one implementation of each route,
  // not two to keep in sync.
  const apiRouters: [string, express.Router][] = [
    ['/auth', authRoutes],
    ['/media', mediaRoutes],
    ['/converter', converterRoutes],
    ['/image', imageRoutes],
    ['/pdf', pdfRoutes],
    ['/whatsapp', whatsappRoutes],
  ];
  for (const [prefix, router] of apiRouters) {
    app.use(`/api${prefix}`, router);
    app.use(`/api/v1${prefix}`, router);
  }
  app.use('/api', systemRoutes);
  app.use('/api/v1', systemRoutes);

  startConverterCleanupScheduler();
  startImageCleanupScheduler();
  startPdfCleanupScheduler();
  startCampaignQueueWorker();
  startReportScheduler();
  startWhatsappHealthScheduler();
  await seedPermissions();
  await validateStartupDependencies();

  // Any /api/* path that reached here matched no route above - respond with
  // a real 404 JSON body instead of falling through to the SPA's index.html
  // catch-all below (which would otherwise "succeed" with an HTML page for
  // a mistyped API call).
  app.use('/api', notFoundHandler);

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

  // Centralized error handler (Part 12) - must be the last app.use() call;
  // Express identifies error middleware by its 4-argument signature and only
  // routes to it errors from things registered before it.
  app.use(errorHandlerMiddleware);

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    appLogger.info(`Enterprise MediaHub Server running on http://0.0.0.0:${PORT}`, { environment: config.nodeEnv, version: config.appVersion });
  });

  const shutdown = async (signal: string) => {
    appLogger.info(`${signal} received, shutting down gracefully...`);
    await stopCampaignQueueWorker();
    await stopReportScheduler();
    await stopWhatsappHealthScheduler();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer();
