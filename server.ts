import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import mediaRoutes from './server/routes/media.routes';
import authRoutes from './server/routes/auth.routes';
import converterRoutes from './server/routes/converter.routes';
import imageRoutes from './server/routes/image.routes';
import { startConverterCleanupScheduler } from './server/services/converter-cleanup.service';
import { startImageCleanupScheduler } from './server/services/image-cleanup.service';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/converter', converterRoutes);
  app.use('/api/image', imageRoutes);

  startConverterCleanupScheduler();
  startImageCleanupScheduler();

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise MediaHub Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
