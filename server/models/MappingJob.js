const mongoose = require('mongoose');

const mappingJobSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: ['UPLOAD_PREVIEW', 'CONFIRM_BATCH'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    uploadMode: {
      type: String,
      enum: ['multi', 'single'],
      default: 'multi',
    },
    sourceFileName: {
      type: String,
      default: '',
    },
    replaceExisting: {
      type: Boolean,
      default: true,
    },
    singleOptions: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    progress: {
      total: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      currentStage: { type: String, default: 'Queued' },
    },
    summary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isMultiRoster: {
      type: Boolean,
      default: false,
    },
    previewMappings: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    inputMappings: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    savedMappings: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    failedItems: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    reusedCount: {
      type: Number,
      default: 0,
    },
    totalEnrollments: {
      type: Number,
      default: 0,
    },
    uniqueStudents: {
      type: Number,
      default: 0,
    },
    errorMessage: {
      type: String,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    createdByName: {
      type: String,
      default: 'Administrator',
    },
    startedAt: Date,
    completedAt: Date,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true }
);

mappingJobSchema.index({ createdBy: 1, createdAt: -1 });
mappingJobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MappingJob', mappingJobSchema);
