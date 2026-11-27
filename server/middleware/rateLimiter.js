const rawRateLimit = require('express-rate-limit');
const rateLimit =
  typeof rawRateLimit === 'function'
    ? rawRateLimit
    : rawRateLimit?.rateLimit || rawRateLimit?.default || rawRateLimit;

if (typeof rateLimit !== 'function') {
  throw new TypeError(`express-rate-limit must resolve to a function (received ${typeof rateLimit})`);
}

// Per-(IP, registrationNumber) limiter prevents scraping a single roll number while allowing
// 500+ distinct students sharing a campus Wi-Fi / NAT IP to look up seats simultaneously.
const studentLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.STUDENT_LOOKUP_PER_ROLL_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || 'unknown';
    const regNo = String(req.body?.registrationNumber || '').trim().toUpperCase();
    return regNo ? `${ip}:${regNo}` : `${ip}:lookup`;
  },
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many lookups for this registration number. Please wait a moment and try again.',
  },
});

// High-ceiling IP burst protection for student portal endpoints during peak 500+ student load on shared campus Wi-Fi NAT
const studentPortalBurstLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.STUDENT_PORTAL_BURST_LIMIT) || 30000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests from this network right now. Please retry in a minute.',
  },
});

// General auth rate limiter (successful logins do not consume failed-attempt quota)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many failed login attempts. Please wait 15 minutes before trying again.',
  },
});

module.exports = { studentLookupLimiter, studentPortalBurstLimiter, authLimiter };
