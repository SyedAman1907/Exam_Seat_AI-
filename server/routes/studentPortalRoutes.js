const express = require('express');
const router = express.Router();
const { getActiveExams, lookupSeat } = require('../controllers/studentPortalController');
const { studentLookupLimiter } = require('../middleware/rateLimiter');

router.get('/active-exams', getActiveExams);
router.post('/lookup', studentLookupLimiter, lookupSeat);

module.exports = router;
