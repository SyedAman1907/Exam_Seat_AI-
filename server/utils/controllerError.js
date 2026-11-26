const mongoose = require('mongoose');
const { isDbConnectivityError } = require('../config/db');

/**
 * Shared controller error responder:
 * - Maps MongoDB connectivity/DNS/topology errors to HTTP 503 DATABASE_UNAVAILABLE
 * - Maps Mongoose CastError/ValidationError to HTTP 400
 * - Logs full message server-side while preventing raw URIs, credentials, or stack traces from leaking in HTTP 500 responses
 */
function sendControllerError(res, error, logLabel = 'Controller Error', publicMessage = 'An unexpected server error occurred. Please try again.') {
  if (isDbConnectivityError(error) || mongoose.connection.readyState !== 1) {
    console.warn(`[${logLabel}] Database connectivity error:`, error?.message || 'disconnected');
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database service is temporarily unavailable while reconnecting to MongoDB Atlas. Please retry shortly.',
    });
  }

  if (error?.name === 'CastError') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_IDENTIFIER',
      message: 'Invalid record identifier supplied.',
    });
  }

  if (error?.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: error.message || 'Validation failed for submitted data.',
    });
  }

  const statusCode = error?.statusCode || 500;
  console.error(`[${logLabel}]`, error?.message || error);

  return res.status(statusCode).json({
    success: false,
    code: statusCode >= 500 ? 'SERVER_ERROR' : 'REQUEST_ERROR',
    message: statusCode >= 500 ? publicMessage : (error?.message || publicMessage),
  });
}

module.exports = { sendControllerError };
