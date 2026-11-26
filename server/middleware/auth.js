const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { isDbConnectivityError } = require('../config/db');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'Access denied. Please log in to proceed.',
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'examseat_ai_super_secret_jwt_key_2026_academic_secure'
    );
  } catch (jwtError) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Session expired or invalid token. Please log in again.',
    });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database service is temporarily unavailable while reconnecting. Your session has been preserved.',
    });
  }

  try {
    req.user = await User.findById(decoded.id).select('-passwordHash').lean();

    if (!req.user || !req.user.isActive) {
      return res.status(401).json({
        success: false,
        code: 'USER_INACTIVE',
        message: 'User account not found or has been deactivated.',
      });
    }

    next();
  } catch (dbError) {
    if (isDbConnectivityError(dbError) || mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while reconnecting. Your session has been preserved.',
      });
    }

    return res.status(500).json({
      success: false,
      code: 'AUTH_LOOKUP_ERROR',
      message: 'Failed to verify user session.',
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: role '${req.user ? req.user.role : 'none'}' does not have sufficient permission.`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
