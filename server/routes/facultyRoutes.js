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
  .get(authorize('admin', 'faculty'), getFaculties)
  .post(authorize('admin'), createFaculty);

router.route('/:id')
  .get(authorize('admin', 'faculty'), getFacultyById)
  .put(authorize('admin'), updateFaculty)
  .delete(authorize('admin'), deleteFaculty);

module.exports = router;
