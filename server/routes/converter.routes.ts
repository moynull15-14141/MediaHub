import { Router } from 'express';
import {
  stampJobId,
  uploadMiddleware,
  handleUploadError,
  upload,
  start,
  listJobsHandler,
  statusHandler,
  downloadHandler,
  deleteHandler,
} from '../controllers/converter.controller';

const router = Router();

router.post('/upload', stampJobId, uploadMiddleware.single('file'), handleUploadError, upload);
router.post('/start', start);
router.get('/jobs', listJobsHandler);
router.get('/status/:id', statusHandler);
router.get('/download/:id', downloadHandler);
router.delete('/:id', deleteHandler);

export default router;
