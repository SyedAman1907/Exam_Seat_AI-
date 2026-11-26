const mongoose = require('mongoose');

const timetableSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: [true, 'Examination date is required'],
      trim: true,
    },
    displayDate: {
      type: String,
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
    academicYear: {
      type: String,
      required: [true, 'Academic year is required'],
      default: '2026-2027',
      trim: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      default: 'Computer Science and Engineering',
      trim: true,
    },
    year: {
      type: String,
      required: [true, 'Academic year level is required'],
      default: 'IV Year',
      trim: true,
    },
    semester: {
      type: String,
      required: [true, 'Semester is required'],
      default: 'I Semester',
      trim: true,
    },
    section: {
      type: String,
      required: [true, 'Section is required'],
      default: 'A1',
      trim: true,
      uppercase: true,
    },
    session: {
      type: String,
      enum: ['FN', 'AN'],
      default: 'FN',
    },
    status: {
      type: String,
      enum: ['scheduled', 'active', 'completed'],
      default: 'scheduled',
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Normalize date representation
timetableSchema.pre('save', function (next) {
  if (this.date) {
    let raw = this.date.trim();
    // If DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [dd, mm, yyyy] = raw.split('/');
      this.date = `${yyyy}-${mm}-${dd}`;
      this.displayDate = raw;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [yyyy, mm, dd] = raw.split('-');
      this.displayDate = `${dd}/${mm}/${yyyy}`;
    } else {
      this.displayDate = raw;
    }
  }
  next();
});

// Unique compound index preventing duplicate exams for the same criteria and subject code
timetableSchema.index(
  { date: 1, session: 1, section: 1, department: 1, year: 1, semester: 1, subjectCode: 1 },
  { unique: true }
);

module.exports = mongoose.model('Timetable', timetableSchema);