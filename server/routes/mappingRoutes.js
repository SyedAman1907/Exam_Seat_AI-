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
    const mime = file.mimetype;
    if (ext === '.pdf' || mime === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF documents are accepted for student roster upload.'));
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

// All routes require authentication
router.use(protect);

// Upload & Preview student roster PDF (Single 'file' field)
router.post('/upload-preview', handleUploadSinglePdf, previewMappingPdf);
router.post('/confirm', confirmMapping);
router.post('/confirm-batch', confirmBatchMappings);
router.route('/')
  .get(getMappings)
  .post(authorize('admin', 'exam_incharge', 'incharge'), createMapping);

router.get('/portal-groups', getPortalGroups);
router.get('/active-options', getActiveMappingOptions);
router.get('/lookup-students', lookupMappedStudents);

router.route('/:id')
  .get(getMappingById)
  .put(authorize('admin', 'exam_incharge', 'incharge'), updateMappingById)
  .delete(authorize('admin'), deleteMapping);

module.exports = router;
