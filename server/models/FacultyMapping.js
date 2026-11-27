const mongoose = require('mongoose');

const mappedStudentSchema = new mongoose.Schema({
  registrationNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  group: {
    type: String,
    enum: ['Group A', 'Group B', 'A', 'B'],
    default: 'Group A',
  },
  a1: { type: String, default: '', trim: true },
  a2: { type: String, default: '', trim: true },
  a3: { type: String, default: '', trim: true },
  a4: { type: String, default: '', trim: true },
  a5: { type: String, default: '', trim: true },
  a6: { type: String, default: '', trim: true },
}, { _id: false });

const facultyMappingSchema = new mongoose.Schema({
  facultyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  facultyIdCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: '',
    index: true,
  },
  facultyName: {
    type: String,
    required: [true, 'Faculty name is required'],
    trim: true,
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
    required: [true, 'Subject code is required'],
    trim: true,
    uppercase: true,
    index: true,
  },
  section: {
    type: String,
    required: [true, 'Section is required'],
    enum: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
    trim: true,
    uppercase: true,
    index: true,
  },
  group: {
    type: String,
    enum: ['Group A', 'Group B', 'ALL'],
    default: 'Group A',
    index: true,
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
    default: 'ACTIVE',
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
  version: {
    type: Number,
    default: 1,
  },
  isCurrent: {
    type: Boolean,
    default: true,
    index: true,
  },
  students: [mappedStudentSchema],
  studentCount: {
    type: Number,
    default: 0,
  },
  sourceFileName: {
    type: String,
    default: '',
  },
  mappedBy: {
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

facultyMappingSchema.pre('save', function (next) {
  if (this.students && Array.isArray(this.students)) {
    this.studentCount = this.students.length;
  }
  this.updatedAt = new Date();
  next();
});

facultyMappingSchema.index({ facultyName: 1, subjectCode: 1, section: 1, isCurrent: 1 });
facultyMappingSchema.index({ subjectCode: 1, section: 1, academicYear: 1, semester: 1, isCurrent: 1 });
facultyMappingSchema.index({ subjectCode: 1, section: 1, isCurrent: 1 });
facultyMappingSchema.index({ academicYear: 1, semester: 1, isCurrent: 1 });
facultyMappingSchema.index({ facultyId: 1, isCurrent: 1 });

module.exports = mongoose.model('FacultyMapping', facultyMappingSchema);
