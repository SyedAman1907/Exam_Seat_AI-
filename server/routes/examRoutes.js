const express = require('express');
const router = express.Router();
const {
  getExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  getRosterPreview,
  retryExam,
  publishExam,
  rejectExam,
  cancelExam,
  requestCancelExam,
  resolveCentralizedMappings,
  createCentralizedExam,
  checkClassroomAvailability,
} = require('../controllers/examController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Examination Mapping Resolution & Creation (Admin, Exam Incharge, and Faculty scoped to own mappings)
router.get('/resolve-mappings', authorize('admin', 'exam_incharge', 'incharge', 'faculty'), resolveCentralizedMappings);
router.get('/check-availability', authorize('admin', 'exam_incharge', 'incharge', 'faculty'), checkClassroomAvailability);
router.post('/check-availability', authorize('admin', 'exam_incharge', 'incharge', 'faculty'), checkClassroomAvailability);
router.post('/create-centralized', authorize('admin', 'exam_incharge', 'incharge', 'faculty'), createCentralizedExam);

router.get('/roster-preview', getRosterPreview);
router.post('/:id/retry', retryExam);
router.post('/:id/request-cancel', requestCancelExam);

// Admin Approval & Publication Actions (Requirements 5 & 6)
router.post('/:id/publish', authorize('admin'), publishExam);
router.post('/:id/reject', authorize('admin'), rejectExam);
router.post('/:id/cancel', authorize('admin'), cancelExam);

router.route('/')
  .get(getExams)
  .post(createExam);

router.route('/:id')
  .get(getExamById)
  .put(updateExam)
  .delete(deleteExam);

module.exports = router;
