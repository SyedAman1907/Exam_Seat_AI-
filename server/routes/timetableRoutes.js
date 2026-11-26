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
const { protect } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(protect);

router.get('/', getTimetables);
router.get('/lookup', lookupSubject);
router.post('/', createTimetable);
router.put('/:id', updateTimetable);
router.delete('/:id', deleteTimetable);
router.post('/import', upload.single('file'), importTimetable);

module.exports = router;