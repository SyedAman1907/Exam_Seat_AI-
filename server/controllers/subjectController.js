const Subject = require('../models/Subject');
const FacultyMapping = require('../models/FacultyMapping');
const AuditLog = require('../models/AuditLog');
const { sendControllerError } = require('../utils/controllerError');

const DEFAULT_SUBJECTS = [
  {
    abbreviation: 'OOAD',
    subjectName: 'Object Oriented Analysis and Design',
    subjectCode: '20A05504T',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    academicYear: '2026-2027',
  },
  {
    abbreviation: 'ATCD',
    subjectName: 'Automata Theory and Compiler Design',
    subjectCode: '20A05501T',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    academicYear: '2026-2027',
  },
  {
    abbreviation: 'AI',
    subjectName: 'Artificial Intelligence',
    subjectCode: '20A05502S',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    academicYear: '2026-2027',
  },
  {
    abbreviation: 'IQTA',
    subjectName: 'Introduction to Quantum Technologies and Applications',
    subjectCode: '20A05505T',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    academicYear: '2026-2027',
  },
  {
    abbreviation: 'CN',
    subjectName: 'Computer Networks',
    subjectCode: '20A05502T',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    academicYear: '2026-2027',
  },
];

/**
 * Idempotently seed the 5 verified department subjects
 */
async function seedDefaultSubjects() {
  for (const s of DEFAULT_SUBJECTS) {
    await Subject.findOneAndUpdate(
      { subjectCode: s.subjectCode },
      {
        $set: {
          subjectName: s.subjectName,
          abbreviation: s.abbreviation,
          department: s.department,
          year: s.year,
          semester: s.semester,
          academicYear: s.academicYear,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

// @desc    Get all subjects from MongoDB master collection + active permanent FacultyMapping subjects
// @route   GET /api/subjects
// @access  Private (Authenticated users)
exports.getSubjects = async (req, res) => {
  try {
    const { all, academicYear, year, semester } = req.query;
    const filter = all === 'true' ? {} : { isActive: { $ne: false } };
    if (academicYear && academicYear !== 'ALL') filter.academicYear = academicYear;
    if (year && year !== 'ALL') filter.year = year;
    if (semester && semester !== 'ALL') filter.semester = semester;

    const mapMatch = { isCurrent: true };
    if (academicYear && academicYear !== 'ALL') mapMatch.academicYear = academicYear;
    if (year && year !== 'ALL') mapMatch.year = year;
    if (semester && semester !== 'ALL') mapMatch.semester = semester;

    let [subjects, mappedSubjects] = await Promise.all([
      Subject.find(filter).sort({ abbreviation: 1, subjectName: 1 }).lean(),
      FacultyMapping.aggregate([
        { $match: mapMatch },
        {
          $group: {
            _id: { $toUpper: { $ifNull: ['$subjectCode', '$subjectName'] } },
            subjectName: { $first: '$subjectName' },
            subjectCode: { $first: '$subjectCode' },
            department: { $first: '$department' },
            year: { $first: '$year' },
            semester: { $first: '$semester' },
            academicYear: { $first: '$academicYear' },
            sectionsCount: { $addToSet: '$section' },
          },
        },
      ]),
    ]);

    // If database has 0 subjects, perform immediate idempotent seed
    if (subjects.length === 0 && Object.keys(filter).length <= 1) {
      await seedDefaultSubjects();
      subjects = await Subject.find(filter).sort({ abbreviation: 1, subjectName: 1 }).lean();
    }

    const byCode = new Map();
    subjects.forEach((s) => {
      const key = String(s.subjectCode || s.subjectName || '').trim().toUpperCase();
      if (key) byCode.set(key, s);
    });

    mappedSubjects.forEach((ms) => {
      const code = String(ms.subjectCode || '').trim().toUpperCase();
      const key = code || String(ms.subjectName || '').trim().toUpperCase();
      if (key && !byCode.has(key)) {
        const cleanName = String(ms.subjectName || code).trim();
        byCode.set(key, {
          _id: `mapped-${key}`,
          subjectName: cleanName,
          subjectCode: code || key,
          abbreviation: cleanName.slice(0, 6).toUpperCase(),
          department: ms.department || 'Computer Science and Engineering',
          year: ms.year || 'III Year',
          semester: ms.semester || 'I Semester',
          academicYear: ms.academicYear || '2026-2027',
          isActive: true,
          fromMapping: true,
        });
      }
    });

    const merged = Array.from(byCode.values()).sort((a, b) =>
      String(a.subjectName || '').localeCompare(String(b.subjectName || ''))
    );

    res.status(200).json({
      success: true,
      count: merged.length,
      data: merged,
    });
  } catch (error) {
    return sendControllerError(res, error, 'Subject getSubjects Error', 'Unable to load subjects.');
  }
};

// @desc    Get single subject
// @route   GET /api/subjects/:id
// @access  Private
exports.getSubjectById = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found.' });
    }
    res.status(200).json({ success: true, data: subject });
  } catch (error) {
    return sendControllerError(res, error, 'Subject getSubjectById Error', 'Unable to load subject.');
  }
};

// @desc    Create new subject in master collection
// @route   POST /api/subjects
// @access  Private (Admin only)
exports.createSubject = async (req, res) => {
  try {
    const { subjectName, subjectCode, abbreviation, department, year, semester, academicYear } = req.body;

    if (!subjectName || !subjectCode) {
      return res.status(400).json({
        success: false,
        message: 'Subject Name and Subject Code are required.',
      });
    }

    const code = subjectCode.trim().toUpperCase();
    const existing = await Subject.findOne({ subjectCode: code });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A subject with code "${code}" already exists (${existing.subjectName}).`,
      });
    }

    const subject = new Subject({
      subjectName: subjectName.trim(),
      subjectCode: code,
      abbreviation: (abbreviation || '').trim().toUpperCase(),
      department: department || 'Computer Science and Engineering',
      year: year || 'III Year',
      semester: semester || 'I Semester',
      academicYear: academicYear || '2026-2027',
      isActive: true,
    });

    await subject.save();

    await AuditLog.create({
      action: 'SUBJECT_CREATED',
      performedBy: req.user?._id,
      performedByName: req.user?.name || 'Administrator',
      details: { subjectId: subject._id, subjectName: subject.subjectName, subjectCode: subject.subjectCode },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: subject, message: 'Subject created successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update subject code / name / details (Admin only)
// @route   PUT /api/subjects/:id
// @access  Private (Admin only)
exports.updateSubject = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found.' });
    }

    const { subjectName, subjectCode, abbreviation, department, year, semester, academicYear, isActive } = req.body;

    if (subjectCode && subjectCode.trim().toUpperCase() !== subject.subjectCode) {
      const newCode = subjectCode.trim().toUpperCase();
      const existing = await Subject.findOne({ subjectCode: newCode, _id: { $ne: subject._id } });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Subject code "${newCode}" is already in use by "${existing.subjectName}".`,
        });
      }
      subject.subjectCode = newCode;
    }

    if (subjectName) subject.subjectName = subjectName.trim();
    if (abbreviation !== undefined) subject.abbreviation = abbreviation.trim().toUpperCase();
    if (department) subject.department = department.trim();
    if (year) subject.year = year.trim();
    if (semester) subject.semester = semester.trim();
    if (academicYear) subject.academicYear = academicYear.trim();
    if (typeof isActive === 'boolean') subject.isActive = isActive;

    await subject.save();

    await AuditLog.create({
      action: 'SUBJECT_UPDATED',
      performedBy: req.user?._id,
      performedByName: req.user?.name || 'Administrator',
      details: { subjectId: subject._id, subjectName: subject.subjectName, subjectCode: subject.subjectCode },
      ipAddress: req.ip,
    });

    res.status(200).json({ success: true, data: subject, message: 'Subject updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Deactivate / Delete subject (Admin only)
// @route   DELETE /api/subjects/:id
// @access  Private (Admin only)
exports.deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found.' });
    }

    subject.isActive = false;
    await subject.save();

    await AuditLog.create({
      action: 'SUBJECT_DEACTIVATED',
      performedBy: req.user?._id,
      performedByName: req.user?.name || 'Administrator',
      details: { subjectId: subject._id, subjectName: subject.subjectName, subjectCode: subject.subjectCode },
      ipAddress: req.ip,
    });

    res.status(200).json({ success: true, message: 'Subject deactivated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.seedDefaultSubjects = seedDefaultSubjects;
