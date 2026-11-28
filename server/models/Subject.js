const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema(
  {
    subjectName: {
      type: String,
      required: [true, 'Subject name is required'],
      trim: true,
    },
    abbreviation: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    subjectCode: {
      type: String,
      required: [true, 'Subject code is required'],
      trim: true,
      uppercase: true,
    },
    department: {
      type: String,
      default: 'Computer Science and Engineering',
      trim: true,
    },
    year: {
      type: String,
      enum: ['II Year', 'III Year', 'IV Year'],
      default: 'IV Year',
    },
    semester: {
      type: String,
      enum: ['Semester 1', 'Semester 2', 'I Semester', 'II Semester'],
      default: 'Semester 1',
    },
    academicYear: {
      type: String,
      required: [true, 'Academic year is required'],
      trim: true,
      default: '2026-2027',
      index: true,
    },
    group: {
      type: String,
      enum: ['Group A', 'Group B', 'ALL'],
      default: 'ALL',
    },
    sections: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

subjectSchema.index({ subjectCode: 1, academicYear: 1, semester: 1 }, { unique: true, name: 'subject_code_acad_sem_idx' });
subjectSchema.index({ subjectCode: 1, department: 1 });
subjectSchema.index({ abbreviation: 1 });
subjectSchema.index({ academicYear: 1, semester: 1, isActive: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
