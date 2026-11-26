const Timetable = require('../models/Timetable');
const ExcelJS = require('exceljs');
const csv = require('csv-parser');
const stream = require('stream');

// Normalize date to YYYY-MM-DD
function normalizeDate(rawDate) {
  if (!rawDate) return '';
  const str = String(rawDate).trim();
  // Match DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    const dd = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    const yyyy = parts[2];
    return `${yyyy}-${mm}-${dd}`;
  }
  // Match YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const parts = str.split('-');
    const yyyy = parts[0];
    const mm = parts[1].padStart(2, '0');
    const dd = parts[2].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return str;
}

function toDisplayDate(isoDate) {
  if (!isoDate) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const [yyyy, mm, dd] = isoDate.split('-');
    return `${dd}/${mm}/${yyyy}`;
  }
  return isoDate;
}

// @desc    Get all timetable entries with filters
// @route   GET /api/timetable
// @access  Private
exports.getTimetables = async (req, res) => {
  try {
    const { department, year, semester, section, session, status, filter } = req.query;
    const query = {};

    if (department) query.department = department;
    if (year) query.year = year;
    if (semester) query.semester = semester;
    if (section) query.section = section.toUpperCase();
    if (session) query.session = session.toUpperCase();
    if (status) query.status = status;

    const todayIso = new Date().toISOString().split('T')[0];

    if (filter === 'upcoming') {
      query.date = { $gte: todayIso };
    } else if (filter === 'today') {
      query.date = todayIso;
    } else if (filter === 'completed') {
      query.$or = [{ date: { $lt: todayIso } }, { status: 'completed' }];
    }

    const timetables = await Timetable.find(query).sort({ date: 1, session: 1 });

    res.status(200).json({
      success: true,
      count: timetables.length,
      data: timetables,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Automatic Subject Detection by Date & Criteria
// @route   GET /api/timetable/lookup
// @access  Private
exports.lookupSubject = async (req, res) => {
  try {
    const { date, department, year, semester, section, session } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an examination date to detect the subject.',
      });
    }

    const normDate = normalizeDate(date);
    const query = {
      $or: [{ date: normDate }, { displayDate: date.trim() }],
    };

    if (department) query.department = department;
    if (year) query.year = year;
    if (semester) query.semester = semester;
    if (section) query.section = section.toUpperCase();
    if (session) query.session = session.toUpperCase();

    const matches = await Timetable.find(query);

    if (matches.length === 0) {
      return res.status(200).json({
        success: false,
        count: 0,
        message: 'No matching examination timetable found.',
      });
    }

    if (matches.length === 1) {
      const match = matches[0];
      return res.status(200).json({
        success: true,
        count: 1,
        requiresSelection: false,
        data: match,
        subjectName: match.subjectName,
        subjectCode: match.subjectCode,
        academicYear: match.academicYear,
        session: match.session,
        section: match.section,
        year: match.year,
        semester: match.semester,
        department: match.department,
        timetableId: match._id,
      });
    }

    // Multiple exams match (e.g., multiple sections or sessions on same date)
    return res.status(200).json({
      success: true,
      count: matches.length,
      requiresSelection: true,
      message: `Multiple examinations found for ${date}. Please select your target section/session.`,
      data: matches,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create new timetable entry
// @route   POST /api/timetable
// @access  Private
exports.createTimetable = async (req, res) => {
  try {
    const {
      date,
      subjectName,
      subjectCode,
      academicYear,
      department,
      year,
      semester,
      section,
      session,
      notes,
    } = req.body;

    if (!date || !subjectName || !subjectCode) {
      return res.status(400).json({
        success: false,
        message: 'Date, Subject Name, and Subject Code are required.',
      });
    }

    const normDate = normalizeDate(date);
    const dispDate = toDisplayDate(normDate);

    // Check duplicate
    const existing = await Timetable.findOne({
      date: normDate,
      session: (session || 'FN').toUpperCase(),
      section: (section || 'A').toUpperCase(),
      department: department || 'Computer Science and Engineering',
      year: year || 'IV Year',
      semester: semester || 'I Semester',
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A timetable entry already exists for ${dispDate} (${session || 'FN'}) Section ${section || 'A'}: ${existing.subjectName}.`,
      });
    }

    const timetable = await Timetable.create({
      date: normDate,
      displayDate: dispDate,
      subjectName: subjectName.trim(),
      subjectCode: subjectCode.trim().toUpperCase(),
      academicYear: academicYear || '2026-2027',
      department: department || 'Computer Science and Engineering',
      year: year || 'IV Year',
      semester: semester || 'I Semester',
      section: (section || 'A').toUpperCase(),
      session: (session || 'FN').toUpperCase(),
      notes: notes || '',
    });

    res.status(201).json({
      success: true,
      data: timetable,
      message: `Timetable scheduled: ${timetable.subjectName} on ${timetable.displayDate}`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update timetable entry
// @route   PUT /api/timetable/:id
// @access  Private
exports.updateTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id);
    if (!timetable) {
      return res.status(404).json({ success: false, message: 'Timetable entry not found.' });
    }

    if (req.body.date) {
      const normDate = normalizeDate(req.body.date);
      timetable.date = normDate;
      timetable.displayDate = toDisplayDate(normDate);
    }
    if (req.body.subjectName) timetable.subjectName = req.body.subjectName.trim();
    if (req.body.subjectCode) timetable.subjectCode = req.body.subjectCode.trim().toUpperCase();
    if (req.body.academicYear) timetable.academicYear = req.body.academicYear;
    if (req.body.department) timetable.department = req.body.department;
    if (req.body.year) timetable.year = req.body.year;
    if (req.body.semester) timetable.semester = req.body.semester;
    if (req.body.section) timetable.section = req.body.section.toUpperCase();
    if (req.body.session) timetable.session = req.body.session.toUpperCase();
    if (req.body.status) timetable.status = req.body.status;
    if (req.body.notes !== undefined) timetable.notes = req.body.notes;

    await timetable.save();

    res.status(200).json({
      success: true,
      data: timetable,
      message: 'Timetable entry updated successfully.',
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete timetable entry
// @route   DELETE /api/timetable/:id
// @access  Private
exports.deleteTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findByIdAndDelete(req.params.id);
    if (!timetable) {
      return res.status(404).json({ success: false, message: 'Timetable entry not found.' });
    }
    res.status(200).json({
      success: true,
      message: 'Timetable entry deleted successfully.',
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Import Timetable from Excel or CSV
// @route   POST /api/timetable/import
// @access  Private
exports.importTimetable = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an Excel or CSV file.' });
    }

    const rows = [];
    const fileName = req.file.originalname.toLowerCase();

    if (fileName.endsWith('.csv')) {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      await new Promise((resolve, reject) => {
        bufferStream
          .pipe(csv())
          .on('data', data => rows.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const worksheet = workbook.worksheets[0];

      if (!worksheet) {
        return res.status(400).json({ success: false, message: 'Excel workbook contains no sheets.' });
      }

      const headers = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, colNumber) => {
            headers[colNumber] = String(cell.value || '').trim();
          });
        } else {
          const rowObj = {};
          row.eachCell((cell, colNumber) => {
            const h = headers[colNumber];
            if (h) {
              rowObj[h] = cell.value ? String(cell.value).trim() : '';
            }
          });
          if (Object.keys(rowObj).length > 0) {
            rows.push(rowObj);
          }
        }
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No records found in uploaded file.' });
    }

    const imported = [];
    let skipped = 0;

    for (const r of rows) {
      // Find date, subject name, subject code from columns
      let rawDate = '';
      let subject = '';
      let code = '';
      let sec = 'A';
      let sess = 'FN';
      let dept = 'Computer Science and Engineering';
      let yr = 'IV Year';
      let sem = 'I Semester';
      let acadYear = '2026-2027';

      for (const [key, val] of Object.entries(r)) {
        const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        const v = String(val).trim();
        if (k.includes('date')) rawDate = v;
        else if (k.includes('code') || k === 'subcode' || k === 'subjectcode') code = v;
        else if (k.includes('sub') || k.includes('name') || k === 'subject' || k === 'subjectname') subject = v;
        else if (k.includes('sec')) sec = v.toUpperCase();
        else if (k.includes('session') || k === 'fn' || k === 'an') sess = v.toUpperCase();
        else if (k.includes('dept')) dept = v;
        else if (k.includes('year') && !k.includes('acad')) yr = v;
        else if (k.includes('sem')) sem = v;
        else if (k.includes('acad')) acadYear = v;
      }

      if (!rawDate || !subject) {
        skipped++;
        continue;
      }

      if (!code) {
        code = subject.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
      }

      const normDate = normalizeDate(rawDate);
      const dispDate = toDisplayDate(normDate);

      // Upsert entry
      const filter = {
        date: normDate,
        session: sess,
        section: sec,
        department: dept,
        year: yr,
        semester: sem,
      };

      const doc = await Timetable.findOneAndUpdate(
        filter,
        {
          date: normDate,
          displayDate: dispDate,
          subjectName: subject,
          subjectCode: code.toUpperCase(),
          academicYear: acadYear,
          department: dept,
          year: yr,
          semester: sem,
          section: sec,
          session: sess,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      imported.push(doc);
    }

    res.status(200).json({
      success: true,
      importedCount: imported.length,
      skippedCount: skipped,
      message: `Successfully processed ${imported.length} timetable entries.`,
      data: imported,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};