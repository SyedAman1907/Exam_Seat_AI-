const mongoose = require('mongoose');

const schedulerLockSchema = new mongoose.Schema({
  lockKey: {
    type: String,
    required: true,
    unique: true,
  },
  ownerId: {
    type: String,
    required: true,
  },
  lockedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },
});

module.exports = mongoose.model('SchedulerLock', schedulerLockSchema);
