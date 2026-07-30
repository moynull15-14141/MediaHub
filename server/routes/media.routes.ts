import { Router } from 'express';
import { analyzeMedia, getHistory, downloadMedia, downloadAudio } from '../controllers/media.controller';

const router = Router();

router.post('/analyze', analyzeMedia);
router.get('/history', getHistory);
router.get('/download', downloadMedia);
router.get('/download/audio', downloadAudio);

export default router;
