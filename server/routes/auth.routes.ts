import { Router } from 'express';
import { register, login, whoami, uploadCookies } from '../controllers/auth.controller';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/whoami', whoami);
router.post('/cookies', uploadCookies);

export default router;
