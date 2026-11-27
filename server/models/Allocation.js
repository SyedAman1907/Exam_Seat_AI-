const mongoose = require('mongoose');

const studentAssignmentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
  },
  registrationNumber: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  seatId: {
    type: String,
    required: true,
  },
  rowNumber: {
    type: Number,
    required: true,
  },
  benchNumber: {
    type: Number,
    required: true,
  },
  seatNumber: {
    type: Number,
    required: true,
  },
  questionPaperSet: {
    type: String,
    enum: ['A', 'B', 'C'],
    required: true,
  },
  fdhNumber: {
    type: String,
    default: '',
  },
  group: {
    type: String,
    default: 'Group A',
  },
  section: {
    type: String,
    default: 'A1',
  },
  classroomName: {
    type: String,
    default: '',
  },
  classroomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
  },
  facultyName: {
    type: String,
    default: '',
  },
  subjectName: {
    type: String,
    default: '',
  },
  subjectCode: {
    type: String,
    default: '',
  },
  a1: { type: String, default: '' },
  a2: { type: String, default: '' },
  a3: { type: String, default: '' },
  a4: { type: String, default: '' },
  a5: { type: String, default: '' },
  a6: { type: String, default: '' },
}, { _id: false });

const allocationSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true,
  },
  group: {
    type: String,
    enum: ['Group A', 'Group B', 'ALL'],
    default: 'Group A',
  },
  rosterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Roster',
  },
  classroomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: false,
  },
  sectionSummaries: [
    {
      section: { type: String, required: true },
      facultyName: { type: String, default: '' },
      studentCount: { type: Number, default: 0 },
      classroomsUsed: [{ type: String }],
      status: { type: String, default: 'GENERATED' },
    },
  ],
  classroomSummaries: [
    {
      classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
      classroomName: { type: String, default: '' },
      roomNumber: { type: String, default: '' },
      section: { type: String, default: '' },
      allocatedStudents: { type: Number, default: 0 },
      capacity: { type: Number, default: 84 },
      availableSeats: { type: Number, default: 84 },
    },
  ],
  version: {
    type: Number,
    required: true,
    default: 1,
  },
  students: [studentAssignmentSchema],
  setDistribution: {
    A: { type: Number, default: 0 },
    B: { type: Number, default: 0 },
    C: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  totalAvailableSeats: {
    type: Number,
    default: 0,
  },
  totalOccupiedSeats: {
    type: Number,
    default: 0,
  },
  validationStatus: {
    isValid: { type: Boolean, default: false },
    hasAdjacentCollisions: { type: Boolean, default: false },
    violations: [
      {
        rowNumber: Number,
        benchNumber: Number,
        seat1: String,
        seat2: String,
        set: String,
      }
    ],
    message: String,
    validatedAt: Date,
  },
  randomSeed: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['DRAFT', 'SCHEDULED', 'GENERATED', 'VERIFIED', 'LOCKED', 'PUBLISHED', 'COMPLETED', 'CANCELLED'],
    default: 'GENERATED',
  },
  completedAt: {
    type: Date,
  },
  isCurrent: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  lockedAt: Date,
  publishedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

allocationSchema.index({ examId: 1, version: 1 }, { unique: true });
allocationSchema.index({ examId: 1, isCurrent: 1, 'students.registrationNumber': 1 });
allocationSchema.index(
  { examId: 1, isCurrent: 1, status: 1, 'students.registrationNumber': 1 },
  { name: 'alloc_lookup_idx' }
);
allocationSchema.index({ isCurrent: 1, status: 1, examId: 1 }, { name: 'alloc_current_status_idx' });
allocationSchema.index({ 'students.registrationNumber': 1 });

module.exports = mongoose.model('Allocation', allocationSchema);
