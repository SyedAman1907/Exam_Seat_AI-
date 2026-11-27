const mongoose = require('mongoose');
const { EXAM_TYPES } = require('../utils/examTypeUtils');

const examSchema = new mongoose.Schema({
  examName: {
    type: String,
    required: [true, 'Examination name is required'],
    trim: true,
  },
  examType: {
    type: String,
    enum: EXAM_TYPES,
    default: 'MID-TERM 1',
    trim: true,
    uppercase: true,
    index: true,
  },
  academicYear: {
    type: String,
    required: [true, 'Academic year is required'],
    trim: true,
    default: '2026-2027',
  },
  department: {
    type: String,
    required: [true, 'Department is required'],
    trim: true,
    default: 'Computer Science and Engineering',
  },
  year: {
    type: String,
    required: [true, 'Year is required'],
    default: 'IV Year',
  },
  semester: {
    type: String,
    required: [true, 'Semester is required'],
    default: 'I Semester',
  },
  section: {
    type: String,
    required: [true, 'Section is required'],
    default: 'A1',
    trim: true,
  },
  subjectName: {
    type: String,
    required: [true, 'Subject name is required'],
    trim: true,
  },
  subjectCode: {
    type: String,
    required: [true, 'Subject code is required'],
    trim: true,
    uppercase: true,
  },
  examDate: {
    type: String,
    required: [true, 'Exam date is required'],
  },
  startTime: {
    type: String,
    default: '09:00 AM',
    trim: true,
  },
  endTime: {
    type: String,
    default: '12:00 PM',
    trim: true,
  },
  startTime24: {
    type: String,
    default: '09:00',
    trim: true,
  },
  endTime24: {
    type: String,
    default: '12:00',
    trim: true,
  },
  allowOvernight: {
    type: Boolean,
    default: false,
  },
  startDateTime: {
    type: Date,
  },
  endDateTime: {
    type: Date,
  },
  publicationTime: {
    type: Date,
  },
  publicationStatus: {
    type: String,
    enum: ['PENDING', 'PUBLISHED', 'FAILED'],
    default: 'PENDING',
  },
  publishedAt: {
    type: Date,
  },
  lastError: {
    type: String,
    default: '',
  },
  session: {
    type: String,
    enum: ['AM', 'PM', 'FN', 'AN'],
    required: [true, 'Session (Morning AM / Afternoon PM) is required'],
    default: 'AM',
  },
  group: {
    type: String,
    enum: ['Group A', 'Group B', 'ALL'],
    default: 'Group A',
  },
  facultyName: {
    type: String,
    default: '',
    trim: true,
  },
  facultyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  classroomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: false,
  },
  isParentExam: {
    type: Boolean,
    default: false,
    index: true,
  },
  parentExamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    default: null,
  },
  sectionAllocations: [
    {
      mappingId: { type: mongoose.Schema.Types.ObjectId, ref: 'FacultyMapping' },
      facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      facultyName: { type: String, default: '' },
      group: { type: String, default: 'Group A' },
      section: { type: String, required: true },
      studentCount: { type: Number, default: 0 },
      mappingVersion: { type: Number, default: 1 },
      classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
      classroomName: { type: String, default: '' },
      roomNumber: { type: String, default: '' },
      rosterSnapshot: [
        {
          sNo: Number,
          registrationNumber: { type: String, required: true },
          name: { type: String, required: true },
          group: { type: String, default: 'Group A' },
          section: { type: String, default: 'A1' },
          seatId: { type: String, default: '' },
          questionPaperSet: { type: String, default: 'A' },
        },
      ],
      attendancePdfUrl: { type: String, default: '' },
      allocationStatus: {
        type: String,
        enum: ['NOT_GENERATED', 'GENERATING', 'GENERATED', 'FAILED', 'COMPLETED', 'CANCELLED'],
        default: 'GENERATED',
      },
    },
  ],
  createdByRole: {
    type: String,
    default: 'exam_incharge',
  },
  rosterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Roster',
  },
  timetableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Timetable',
  },
  regPattern: {
    type: String,
    default: '^[0-9]{5}[A-Z0-9]{5}$', // Default supports 24091A0501 format
  },
  regPatternDescription: {
    type: String,
    default: '10-character alphanumeric registration number (e.g., 24091A0501)',
  },
  // Separation of Examination Statuses
  approvalStatus: {
    type: String,
    enum: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
    default: 'PENDING_REVIEW',
    index: true,
  },
  visibilityStatus: {
    type: String,
    enum: ['NOT_SCHEDULED', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'WINDOW_CLOSED'],
    default: 'NOT_SCHEDULED',
    index: true,
  },
  allocationStatus: {
    type: String,
    enum: ['NOT_GENERATED', 'GENERATING', 'GENERATED', 'FAILED', 'COMPLETED', 'CANCELLED'],
    default: 'GENERATED',
    index: true,
  },
  completedAt: {
    type: Date,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedByName: {
    type: String,
    default: '',
  },
  approvedAt: {
    type: Date,
  },
  rejectionReason: {
    type: String,
    default: '',
  },
  cancellationReason: {
    type: String,
    default: '',
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  cancelledByName: {
    type: String,
    default: '',
  },
  cancelledAt: {
    type: Date,
  },
  cancellationRequested: {
    type: Boolean,
    default: false,
  },
  cancellationRequestReason: {
    type: String,
    default: '',
  },
  cancellationRequestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  cancellationRequestedByName: {
    type: String,
    default: '',
  },
  cancellationRequestedAt: {
    type: Date,
  },
  mappingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FacultyMapping',
  },
  mappingVersion: {
    type: Number,
    default: 1,
  },
  rosterSnapshot: [
    {
      registrationNumber: { type: String, required: true },
      name: { type: String, required: true },
      group: { type: String, default: 'Group A' },
      a1: { type: String, default: '' },
      a2: { type: String, default: '' },
      a3: { type: String, default: '' },
      a4: { type: String, default: '' },
      a5: { type: String, default: '' },
      a6: { type: String, default: '' },
    },
  ],
  status: {
    type: String,
    enum: [
      'DRAFT',
      'SCHEDULED',
      'GENERATED',
      'ALLOCATED',
      'VERIFIED',
      'LOCKED',
      'PUBLISHED',
      'ONGOING',
      'COMPLETED',
      'CANCELLED',
      'FAILED',
      'STUDENTS_IMPORTED',
    ],
    default: 'DRAFT',
  },
  studentCount: {
    type: Number,
    default: 0,
  },
  currentAllocationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Allocation',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Non-unique compound lookup index: interval overlap & duplicate rules are enforced
// accurately in application logic across exact startDateTime/endDateTime spans.
examSchema.index(
  {
    subjectCode: 1,
    examDate: 1,
    startTime: 1,
    endTime: 1,
    academicYear: 1,
    year: 1,
    section: 1,
    group: 1,
  },
  {
    name: 'exam_schedule_lookup_idx',
  }
);
examSchema.index({ isDeleted: 1, examDate: 1, status: 1 });
examSchema.index({ isDeleted: 1, approvalStatus: 1, status: 1, examDate: 1 });
examSchema.index(
  { examDate: 1, isDeleted: 1, approvalStatus: 1, status: 1, visibilityStatus: 1 },
  { name: 'exam_portal_active_idx' }
);
examSchema.index(
  { isDeleted: 1, visibilityStatus: 1, publicationTime: 1 },
  { name: 'exam_scheduler_pub_idx' }
);
examSchema.index({ createdBy: 1, createdAt: -1 });
examSchema.index({ academicYear: 1, semester: 1, isDeleted: 1 });
examSchema.index({ isDeleted: 1, examType: 1, examDate: 1 }, { name: 'exam_type_date_idx' });
examSchema.index(
  { isDeleted: 1, classroomId: 1, startDateTime: 1, endDateTime: 1 },
  { name: 'exam_room_interval_idx' }
);
examSchema.index(
  { isDeleted: 1, 'sectionAllocations.classroomId': 1, startDateTime: 1, endDateTime: 1 },
  { name: 'exam_sec_room_interval_idx' }
);

module.exports = mongoose.model('Exam', examSchema);
