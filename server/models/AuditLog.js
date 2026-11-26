const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'USER_LOGIN',
      'USER_LOGOUT',
      'EXAM_CREATED',
      'EXAM_UPDATED',
      'EXAM_CONTROLLED_CORRECTION',
      'EXAM_DELETED',
      'STUDENTS_IMPORTED',
      'REAL_STUDENTS_IMPORTED',
      'STUDENT_UPDATED',
      'CLASSROOM_CREATED',
      'CLASSROOM_UPDATED',
      'ALLOCATION_GENERATED',
      'ALLOCATION_REGENERATED',
      'ALLOCATION_VERIFIED',
      'ALLOCATION_LOCKED',
      'ALLOCATION_PUBLISHED',
      'EXAM_PUBLISHED',
      'EXAM_APPROVED',
      'EXAM_REJECTED',
      'EXAM_CANCELLED',
      'EXAM_CANCEL_REQUESTED',
      'EXAM_COMPLETED',
      'MAPPING_CREATED',
      'MAPPING_UPDATED',
      'FACULTY_MAPPING_BATCH_CONFIRMED',
      'ALLOCATION_UNLOCKED',
      'REPORT_GENERATED',
      'SUBJECT_CREATED',
      'SUBJECT_UPDATED',
      'SUBJECT_DEACTIVATED'
    ],
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  performedByName: {
    type: String,
    default: 'System',
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
  },
  allocationVersion: {
    type: Number,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: String,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

auditLogSchema.index({ examId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
