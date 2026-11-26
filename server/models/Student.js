const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  registrationNumber: {
    type: String,
    required: [true, 'Registration number is required'],
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true,
  },
  department: {
    type: String,
    default: 'Computer Science and Engineering',
    trim: true,
  },
  year: {
    type: String,
    default: 'IV Year',
  },
  semester: {
    type: String,
    default: 'I Semester',
  },
  section: {
    type: String,
    default: 'A',
    trim: true,
    uppercase: true,
  },
  academicYear: {
    type: String,
    default: '2026-2027',
  },
  subject: {
    type: String,
    default: '',
    trim: true,
  },
  facultyName: {
    type: String,
    default: '',
    trim: true,
  },
  group: {
    type: String,
    enum: ['Group A', 'Group B', 'A', 'B'],
    default: 'Group A',
  },
  fdhNumber: {
    type: String,
    default: '',
    trim: true,
  },
  a1: { type: String, default: '', trim: true },
  a2: { type: String, default: '', trim: true },
  a3: { type: String, default: '', trim: true },
  a4: { type: String, default: '', trim: true },
  a5: { type: String, default: '', trim: true },
  a6: { type: String, default: '', trim: true },
  verifiedByFaculty: {
    type: Boolean,
    default: false,
  },
  rosterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Roster',
    index: true,
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'detained'],
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for fast lookup by registration number, group, section, and academic scope
studentSchema.index({ registrationNumber: 1 });
studentSchema.index({ examId: 1, registrationNumber: 1 });
studentSchema.index({ examId: 1, section: 1, group: 1 });
studentSchema.index({ rosterId: 1, registrationNumber: 1 });
studentSchema.index({ section: 1, group: 1, registrationNumber: 1 });
studentSchema.index({ academicYear: 1, semester: 1 });
studentSchema.index({ group: 1 });

module.exports = mongoose.model('Student', studentSchema);
