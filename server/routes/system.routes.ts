import { Router } from 'express';
import { healthHandler, statusHandler, systemHandler, diagnosticsHandler } from '../controllers/system.controller';

// Deliberately unauthenticated (Part 1/2) - these are infra probes meant for
// a load balancer, uptime monitor, or ops dashboard hitting them without a
// user session, matching how every standard health-check convention works.
// None of them expose secrets: config values are reduced to booleans
// ("JWT_SECRET configured: true/false"), never the values themselves.
const router = Router();

router.get('/health', healthHandler);
router.get('/status', statusHandler);
router.get('/system', systemHandler);
router.get('/system/diagnostics', diagnosticsHandler);

export default router;
