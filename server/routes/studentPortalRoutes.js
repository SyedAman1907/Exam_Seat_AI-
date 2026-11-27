const express = require('express');
const router = express.Router();
const { getActiveExams, getStudentExams, lookupSeat } = require('../controllers/studentPortalController');
const { protect, authorize } = require('../middleware/auth');
const { studentLookupLimiter, studentPortalBurstLimiter } = require('../middleware/rateLimiter');

// Optional JWT extractor so public Seat Finder / k6 load tests work while authenticated Student tokens strictly isolate own records
const attachOptionalAuth = (req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return protect(req, res, next);
  }
  return next();
};

router.get('/my-exams', studentPortalBurstLimiter, protect, authorize('student'), getStudentExams);
router.get('/active-exams', studentPortalBurstLimiter, attachOptionalAuth, getActiveExams);
router.post('/lookup', studentPortalBurstLimiter, attachOptionalAuth, studentLookupLimiter, lookupSeat);

module.exports = router;
