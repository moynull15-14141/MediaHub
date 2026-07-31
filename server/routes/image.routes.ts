import { Router } from 'express';
import {
  stampJobId,
  uploadMiddleware,
  processUploadMiddleware,
  handleUploadError,
  upload,
  processHandler,
  metadataHandler,
  listJobsHandler,
  downloadHandler,
  deleteHandler,
} from '../controllers/image.controller';

const router = Router();

router.post('/upload', stampJobId, uploadMiddleware.single('file'), handleUploadError, upload);
router.post('/process', processUploadMiddleware, handleUploadError, processHandler);
router.get('/metadata/:id', metadataHandler);
router.get('/jobs', listJobsHandler);
router.get('/download/:id', downloadHandler);
router.delete('/:id', deleteHandler);

export default router;
