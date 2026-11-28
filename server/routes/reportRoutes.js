const express = require('express');
const router = express.Router();
const {
  getMasterPDF,
  getSignaturePDF,
  getGroupAttendancePDF,
  getSeatingPDF,
  getExcelReport,
  getMasterStudentsExcel,
  getSubjectWiseExcel,
  getFacultyWiseExcel,
  getSectionAttendancePDF,
  getCentralizedAttendanceZip,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin', 'faculty'));

// Global Master / Subject / Faculty exports
router.get('/master-students-excel', getMasterStudentsExcel);
router.get('/subject-wise-excel', getSubjectWiseExcel);
router.get('/faculty-wise-excel', getFacultyWiseExcel);

// Exam-specific reports
router.get('/:id/section-attendance-pdf/:section', getSectionAttendancePDF);
router.get('/:id/reports/section-attendance-pdf/:section', getSectionAttendancePDF);
router.get('/:id/attendance-zip', getCentralizedAttendanceZip);
router.get('/:id/reports/attendance-zip', getCentralizedAttendanceZip);
router.get('/:id/reports/master-pdf', getMasterPDF);
router.get('/:id/master-pdf', getMasterPDF);
router.get('/:id/reports/signature-pdf', getSignaturePDF);
router.get('/:id/signature-pdf', getSignaturePDF);
router.get('/:id/reports/group-attendance-pdf', getGroupAttendancePDF);
router.get('/:id/group-attendance-pdf', getGroupAttendancePDF);
router.get('/:id/reports/seating-pdf', getSeatingPDF);
router.get('/:id/seating-pdf', getSeatingPDF);
router.get('/:id/reports/excel', getExcelReport);
router.get('/:id/excel', getExcelReport);

module.exports = router;
