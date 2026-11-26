const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const {
  importPreview,
  multiPdfPreview,
  multiPdfConfirm,
  getStudentDatabase,
  getStudentFilterOptions,
  getStudents,
  getStudentById,
  createStudent,
  confirmStudents,
  getStudentsByExam,
  updateStudent,
  deleteStudent,
  clearAllStudents,
} = require('../controllers/studentController');
const { protect } = require('../middleware/auth');

// Multer storage configuration (use writable /tmp on read-only Vercel serverless filesystem)
const uploadsDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'examseat-uploads')
  : path.join(__dirname, '../uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `import-${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, XLSX, XLS, and CSV files are accepted.'));
    }
  },
});

router.use(protect);

// Multi-file student PDF/Excel/CSV endpoints
router.post('/multi-pdf-preview', upload.array('files', 20), multiPdfPreview);
router.post('/multi-pdf-confirm', multiPdfConfirm);
router.get('/database', getStudentDatabase);
router.get('/filters', getStudentFilterOptions);
router.delete('/clear-all', clearAllStudents);

// Direct Student CRUD endpoints
router.route('/')
  .get(getStudents)
  .post(createStudent);

// Legacy single-file and exam-specific endpoints
router.post('/import-preview', upload.single('file'), importPreview);
router.post('/confirm', confirmStudents);
router.get('/exam/:id', getStudentsByExam);
router.route('/:id')
  .get(getStudentById)
  .put(updateStudent)
  .delete(deleteStudent);

module.exports = router;
