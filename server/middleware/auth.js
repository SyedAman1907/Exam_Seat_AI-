const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const FacultyMapping = require('../models/FacultyMapping');
const { isDbConnectivityError } = require('../config/db');

const ALLOWED_ROLES = new Set(['admin', 'faculty', 'student']);

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
    if (decoded.role === 'student' && decoded.registrationNumber) {
      const cleanReg = String(decoded.registrationNumber).trim().toUpperCase();
      let studentUser = decoded.id
        ? await User.findById(decoded.id).select('-passwordHash').lean()
        : null;

      if (studentUser && (!studentUser.isActive || studentUser.role !== 'student')) {
        return res.status(401).json({
          success: false,
          code: 'USER_INACTIVE',
          message: 'Student account is inactive or invalid.',
        });
      }

      if (!studentUser) {
        const [studentRec, enrollmentRec, mappedRec] = await Promise.all([
          Student.findOne({ registrationNumber: cleanReg, status: { $ne: 'inactive' } })
            .select('registrationNumber name department section group')
            .lean(),
          StudentEnrollment.findOne({ rollNumber: cleanReg })
            .select('rollNumber studentName department section group')
            .lean(),
          FacultyMapping.findOne({ isCurrent: true, 'students.registrationNumber': cleanReg })
            .select('department section group students.$')
            .lean(),
        ]);

        const mappedStudent = mappedRec?.students?.[0];
        if (!studentRec && !enrollmentRec && !mappedStudent) {
          return res.status(401).json({
            success: false,
            code: 'USER_INACTIVE',
            message: 'Student registration number was not found in active institutional records.',
          });
        }

        studentUser = {
          _id: null,
          role: 'student',
          registrationNumber: cleanReg,
          name: studentRec?.name || enrollmentRec?.studentName || mappedStudent?.name || cleanReg,
          department:
            studentRec?.department ||
            enrollmentRec?.department ||
            mappedRec?.department ||
            'Computer Science and Engineering',
          section: studentRec?.section || enrollmentRec?.section || mappedRec?.section || '',
          group: studentRec?.group || enrollmentRec?.group || mappedStudent?.group || mappedRec?.group || '',
          isActive: true,
        };
      }

      req.user = studentUser;
      return next();
    }

    req.user = await User.findById(decoded.id).select('-passwordHash').lean();

    if (!req.user || !req.user.isActive) {
      return res.status(401).json({
        success: false,
        code: 'USER_INACTIVE',
        message: 'User account not found or has been deactivated.',
      });
    }

    if (!ALLOWED_ROLES.has(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'ROLE_DEPRECATED',
        message: 'This account role is no longer supported. Please contact the Administrator.',
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
