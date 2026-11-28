const express = require('express');
const router = express.Router();
const {
  getExams,
  getCurrentExamination,
  getSectionRoster,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  getRosterPreview,
  retryExam,
  approveExam,
  publishExam,
  rejectExam,
  cancelExam,
  requestCancelExam,
  resolveCentralizedMappings,
  createCentralizedExam,
  checkClassroomAvailability,
} = require('../controllers/examController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin', 'faculty'));

// Current Examination & Single-Section Roster Resolution
router.get('/current', authorize('admin', 'faculty'), getCurrentExamination);
router.get('/section-roster', authorize('admin', 'faculty'), getSectionRoster);

// Examination Mapping Resolution & Creation (Admin and Faculty scoped strictly to own mappings)
router.get('/resolve-mappings', authorize('admin', 'faculty'), resolveCentralizedMappings);
router.get('/check-availability', authorize('admin', 'faculty'), checkClassroomAvailability);
router.post('/check-availability', authorize('admin', 'faculty'), checkClassroomAvailability);
router.post('/create-centralized', authorize('admin', 'faculty'), createCentralizedExam);

router.get('/roster-preview', getRosterPreview);
router.post('/:id/retry', retryExam);
router.post('/:id/request-cancel', requestCancelExam);

// Admin Approval & Publication Actions (Requirements 5 & 6)
router.post('/:id/approve', authorize('admin'), approveExam);
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
