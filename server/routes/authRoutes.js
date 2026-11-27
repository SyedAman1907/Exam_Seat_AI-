const express = require('express');
const router = express.Router();
const { login, studentLogin, logout, getMe, forgotPassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/login', authLimiter, login);
router.post('/student-login', authLimiter, studentLogin);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.post('/forgot-password', authLimiter, forgotPassword);

module.exports = router;
