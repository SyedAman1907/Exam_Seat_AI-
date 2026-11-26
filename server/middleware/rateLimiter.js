const rawRateLimit = require('express-rate-limit');
const rateLimit =
  typeof rawRateLimit === 'function'
    ? rawRateLimit
    : rawRateLimit?.rateLimit || rawRateLimit?.default || rawRateLimit;

if (typeof rateLimit !== 'function') {
  throw new TypeError(`express-rate-limit must resolve to a function (received ${typeof rateLimit})`);
}

// Rate limiter for student seat lookup (prevent brute force student scraping)
const studentLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 lookups per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many search requests from this IP address. Please wait 15 minutes before trying again.',
  },
});

// General auth rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please wait 15 minutes before trying again.',
  },
});

module.exports = { studentLookupLimiter, authLimiter };
