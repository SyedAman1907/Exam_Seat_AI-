const mongoose = require('mongoose');

const studentEnrollmentSchema = new mongoose.Schema({
  rollNumber: {
    type: String,
    required: [true, 'Roll number is required'],
    trim: true,
    uppercase: true,
    index: true,
  },
  studentName: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true,
  },
  facultyName: {
    type: String,
    default: '',
    trim: true,
  },
  section: {
    type: String,
    default: 'A',
    trim: true,
    uppercase: true,
    index: true,
  },
  subjectName: {
    type: String,
    required: [true, 'Subject name is required'],
    trim: true,
    index: true,
  },
  subjectCode: {
    type: String,
    default: '',
    trim: true,
    uppercase: true,
  },
  group: {
    type: String,
    enum: ['Group A', 'Group B', 'A', 'B'],
    default: 'Group A',
    index: true,
  },
  academicYear: {
    type: String,
    default: '2026-2027',
  },
  department: {
    type: String,
    default: 'Computer Science and Engineering',
  },
  year: {
    type: String,
    default: 'IV Year',
  },
  semester: {
    type: String,
    default: 'I Semester',
  },
  // Assessment / Activity columns A1 through A6
  a1: { type: String, default: '', trim: true },
  a2: { type: String, default: '', trim: true },
  a3: { type: String, default: '', trim: true },
  a4: { type: String, default: '', trim: true },
  a5: { type: String, default: '', trim: true },
  a6: { type: String, default: '', trim: true },
  // Preserved FDH roll number
  fdhNumber: {
    type: String,
    default: '',
    trim: true,
  },
  sourceFileName: {
    type: String,
    default: '',
  },
  verifiedByFaculty: {
    type: Boolean,
    default: false,
  },
  needsVerification: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Composite unique index so one student has one enrollment record per subject and academic year
studentEnrollmentSchema.index({ rollNumber: 1, subjectName: 1, academicYear: 1 }, { unique: true });
studentEnrollmentSchema.index({ subjectName: 1, section: 1, group: 1 });
studentEnrollmentSchema.index({ section: 1, group: 1, rollNumber: 1 });
studentEnrollmentSchema.index({ academicYear: 1, semester: 1, section: 1 });
studentEnrollmentSchema.index({ facultyName: 1 });

module.exports = mongoose.model('StudentEnrollment', studentEnrollmentSchema);
