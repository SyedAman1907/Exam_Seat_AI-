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
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/section-mappings')
  .get(getSectionMappings)
  .put(updateSectionMappings);

router.route('/')
  .get(getClassrooms)
  .post(createClassroom);

router.route('/:id')
  .get(getClassroomById)
  .put(updateClassroom);

module.exports = router;
