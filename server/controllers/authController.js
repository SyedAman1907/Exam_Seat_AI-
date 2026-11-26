const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { isDbConnectivityError } = require('../config/db');

const signToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'examseat_ai_super_secret_jwt_key_2026_academic_secure',
    { expiresIn: '12h' }
  );
};

// @desc    Faculty / Admin Login
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    // Check if database is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is currently unavailable. Please verify MongoDB is running.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawIdentifier = body.email || body.username || body.identifier;
    const password = body.password;

    if (!rawIdentifier || typeof password !== 'string' || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: 'Please provide both email/username and password.',
      });
    }

    const identifier = String(rawIdentifier).toLowerCase().trim();

    // Look up by email, username, or college email prefix
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier },
        { email: `${identifier}@rgmcet.edu.in` },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials. Please verify your email/username and password.',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials. Please verify your email/username and password.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated. Please contact Exam Cell administration.',
      });
    }

    const token = signToken(user._id);

    // Audit Log (safely handled so audit failure does not block login)
    try {
      await AuditLog.create({
        action: 'USER_LOGIN',
        performedBy: user._id,
        performedByName: user.name,
        details: { email: user.email, role: user.role },
        ipAddress: req.ip,
      });
    } catch (auditErr) {
      console.warn('[Audit Log Warning]', auditErr.message);
    }

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        department: user.department,
        designation: user.designation,
      },
    });
  } catch (error) {
    if (isDbConnectivityError(error) || mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable (reconnecting to MongoDB Atlas). Please retry in a few seconds.',
      });
    }

    console.error('[Auth Login Error]', error.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Authentication service encountered an unexpected error. Please try again.',
    });
  }
};

// @desc    Get Current Logged in Faculty Profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    if (req.user && req.user._id) {
      return res.status(200).json({
        success: true,
        user: req.user,
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while reconnecting.',
      });
    }

    const user = await User.findById(req.user?._id || req.user?.id).select('-passwordHash').lean();
    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Account not found or session invalid.',
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    if (isDbConnectivityError(error) || mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while reconnecting.',
      });
    }

    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message,
    });
  }
};

// @desc    Logout
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    if (req.user) {
      try {
        await AuditLog.create({
          action: 'USER_LOGOUT',
          performedBy: req.user._id,
          performedByName: req.user.name,
          details: { email: req.user.email },
          ipAddress: req.ip,
        });
      } catch (auditErr) {
        console.warn('[Audit Log Warning]', auditErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message,
    });
  }
};

// @desc    Forgot Password Request
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (email) {
      await User.findOne({ email: email.toLowerCase().trim() });
    }

    // Academic security best practice: don't reveal user existence
    res.status(200).json({
      success: true,
      message: 'If an active account exists for this email, password reset instructions have been forwarded to the Controller of Examinations.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message,
    });
  }
};