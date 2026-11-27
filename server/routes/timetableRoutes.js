const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  getTimetables,
  lookupSubject,
  createTimetable,
  updateTimetable,
  deleteTimetable,
  importTimetable,
} = require('../controllers/timetableController');
const { protect, authorize } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect, authorize('admin', 'faculty'));

router.get('/', getTimetables);
router.get('/lookup', lookupSubject);
router.post('/', authorize('admin'), createTimetable);
router.put('/:id', authorize('admin'), updateTimetable);
router.delete('/:id', authorize('admin'), deleteTimetable);
router.post('/import', authorize('admin'), upload.single('file'), importTimetable);

module.exports = router;