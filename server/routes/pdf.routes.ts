import { Router } from 'express';
import {
  stampJobId,
  uploadMiddleware,
  handleUploadError,
  upload,
  processHandler,
  listJobsHandler,
  statusHandler,
  textItemsHandler,
  downloadHandler,
  deleteHandler,
} from '../controllers/pdf.controller';

const router = Router();

router.post('/upload', stampJobId, uploadMiddleware.array('files'), handleUploadError, upload);
router.post('/process', processHandler);
router.get('/jobs', listJobsHandler);
router.get('/status/:id', statusHandler);
router.get('/text-items/:id/:page', textItemsHandler);
router.get('/download/:id', downloadHandler);
router.delete('/:id', deleteHandler);

export default router;
