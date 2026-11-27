const express = require('express');
const router = express.Router();
const { getActiveExams, lookupSeat } = require('../controllers/studentPortalController');
const { studentLookupLimiter, studentPortalBurstLimiter } = require('../middleware/rateLimiter');

router.get('/active-exams', studentPortalBurstLimiter, getActiveExams);
router.post('/lookup', studentPortalBurstLimiter, studentLookupLimiter, lookupSeat);

module.exports = router;
