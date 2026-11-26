const express = require('express');
const router = express.Router();
const {
  getFaculties,
  getFacultyById,
  createFaculty,
  updateFaculty,
  deleteFaculty,
} = require('../controllers/facultyController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getFaculties)
  .post(authorize('admin', 'exam_incharge'), createFaculty);

router.route('/:id')
  .get(getFacultyById)
  .put(authorize('admin', 'exam_incharge'), updateFaculty)
  .delete(authorize('admin'), deleteFaculty);

module.exports = router;
