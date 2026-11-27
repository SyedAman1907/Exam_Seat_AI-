const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { protect, authorize } = require('../middleware/auth');
const {
  previewMappingPdf,
  confirmMapping,
  confirmBatchMappings,
  startUploadPreviewJob,
  startConfirmBatchJob,
  getMappingJobStatus,
  listMappingJobs,
  retryMappingJobHandler,
  getMappings,
  createMapping,
  getPortalGroups,
  getActiveMappingOptions,
  getMappingById,
  updateMappingById,
  lookupMappedStudents,
  deleteMapping,
} = require('../controllers/mappingController');

// Configure Multer storage for PDF uploads (use writable /tmp on read-only Vercel serverless filesystem)
const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'examseat-uploads')
  : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `mapping-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (
      ext === '.pdf' ||
      ext === '.xlsx' ||
      ext === '.xls' ||
      ext === '.csv' ||
      mime === 'application/pdf' ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime.includes('csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Accepted formats: PDF, XLSX, XLS, and CSV.'));
    }
  },
});

// Single file upload middleware with robust error interception
const handleUploadSinglePdf = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[Multer Error in /mappings/upload-preview]:', err.message || err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'The uploaded file exceeds the 30MB limit. Please upload a smaller PDF.',
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: `Unexpected upload field '${err.field}'. Expected 'file'.`,
          });
        }
        return res.status(400).json({
          success: false,
          message: `File upload error: ${err.message}`,
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid file uploaded. Please upload a valid PDF document.',
      });
    }
    next();
  });
};

// All routes require authentication (Admin & Faculty only)
router.use(protect, authorize('admin', 'faculty'));

// Admin-only mapping import & batch persistence endpoints
router.post('/jobs/upload-preview', authorize('admin'), handleUploadSinglePdf, startUploadPreviewJob);
router.post('/jobs/confirm-batch', authorize('admin'), startConfirmBatchJob);
router.get('/jobs', authorize('admin'), listMappingJobs);
router.get('/jobs/:jobId', authorize('admin'), getMappingJobStatus);
router.post('/jobs/:jobId/retry', authorize('admin'), retryMappingJobHandler);

// Admin-only upload preview & confirm endpoints
router.post('/upload-preview', authorize('admin'), handleUploadSinglePdf, previewMappingPdf);
router.post('/confirm', authorize('admin'), confirmMapping);
router.post('/confirm-batch', authorize('admin'), confirmBatchMappings);
router.route('/')
  .get(getMappings)
  .post(authorize('admin'), createMapping);

router.get('/portal-groups', getPortalGroups);
router.get('/active-options', getActiveMappingOptions);
router.get('/lookup-students', lookupMappedStudents);

router.route('/:id')
  .get(getMappingById)
  .put(authorize('admin'), updateMappingById)
  .delete(authorize('admin'), deleteMapping);

module.exports = router;
