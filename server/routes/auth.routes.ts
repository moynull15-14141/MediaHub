import { Router } from 'express';
import { register, login, whoami, refresh, logout, logoutAll, loginHistoryHandler, uploadCookies } from '../controllers/auth.controller';
import { authRateLimiter } from '../middleware/security.middleware';
import { requireCsrfToken } from '../middleware/csrf.middleware';

const router = Router();

router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);
router.get('/whoami', whoami);
// refresh/logout are the only endpoints authenticated purely by an ambient
// cookie (no Authorization header) - see csrf.middleware.ts for why only
// these two need the CSRF check.
router.post('/refresh', requireCsrfToken, refresh);
router.post('/logout', requireCsrfToken, logout);
router.post('/logout-all', logoutAll);
router.get('/login-history', loginHistoryHandler);
router.post('/cookies', uploadCookies);

export default router;
