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
      unique: true,
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
      default: 'III Year',
    },
    semester: {
      type: String,
      default: 'I Semester',
    },
    academicYear: {
      type: String,
      default: '2026-2027',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

subjectSchema.index({ subjectCode: 1, department: 1 });
subjectSchema.index({ abbreviation: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
