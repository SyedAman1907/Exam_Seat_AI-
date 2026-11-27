const express = require('express');
const router = express.Router();
const {
  getClassrooms,
  getClassroomById,
  createClassroom,
  updateClassroom,
  getSectionMappings,
  updateSectionMappings,
} = require('../controllers/classroomController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin', 'faculty'));

router.route('/section-mappings')
  .get(getSectionMappings)
  .put(authorize('admin'), updateSectionMappings);

router.route('/')
  .get(getClassrooms)
  .post(authorize('admin'), createClassroom);

router.route('/:id')
  .get(getClassroomById)
  .put(authorize('admin'), updateClassroom);

module.exports = router;
