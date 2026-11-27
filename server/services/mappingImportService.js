const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const csv = require('csv-parser');
const Student = require('../models/Student');
const StudentClassificationService = require('./studentClassificationService');

const SPREADSHEET_EXTS = new Set(['.xlsx', '.xls', '.csv']);
const VALID_SECTIONS = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);

function isSpreadsheetFile(filePath = '', originalName = '') {
  const ext = path.extname(originalName || filePath || '').toLowerCase();
  return SPREADSHEET_EXTS.has(ext);
}

function normKey(rawKey) {
  return String(rawKey || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickField(rowObj, aliases) {
  for (const key of Object.keys(rowObj || {})) {
    const normalized = normKey(key);
    if (aliases.includes(normalized)) {
      const val = rowObj[key];
      if (val !== null && val !== undefined && String(val).trim() !== '') {
        return String(val).trim();
      }
    }
  }
  return '';
}

async function readCsvRows(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function readExcelRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const rows = [];

  workbook.eachSheet((worksheet) => {
    let headers = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = row.values || [];
      if (rowNumber === 1 || headers.length === 0) {
        const candidate = values
          .slice(1)
          .map((cell) => (cell && typeof cell === 'object' && cell.text ? cell.text : String(cell || '').trim()));
        if (candidate.some((v) => /reg|roll|htno|name|subject|section/i.test(v))) {
          headers = candidate;
          return;
        }
      }
      if (headers.length > 0) {
        const obj = {};
        let hasValue = false;
        headers.forEach((h, idx) => {
          if (!h) return;
          const rawCell = values[idx + 1];
          const val =
            rawCell && typeof rawCell === 'object' && rawCell.text
              ? rawCell.text
              : rawCell && typeof rawCell === 'object' && rawCell.result !== undefined
                ? rawCell.result
                : rawCell;
          const str = val !== null && val !== undefined ? String(val).trim() : '';
          if (str) hasValue = true;
          obj[h] = str;
        });
        if (hasValue) rows.push(obj);
      }
    });
  });

  return rows;
}

async function parseSpreadsheetMappings(filePath, originalName = '', defaults = {}) {
  const ext = path.extname(originalName || filePath || '').toLowerCase();
  const rawRows = ext === '.csv' ? await readCsvRows(filePath) : await readExcelRows(filePath);

  if (!rawRows || rawRows.length === 0) {
    throw new Error('No tabular data rows found in the uploaded spreadsheet.');
  }

  const grouped = new Map();
  const rowErrors = [];

  rawRows.forEach((row, idx) => {
    const regNo = pickField(row, ['registrationnumber', 'regno', 'rollnumber', 'rollno', 'htno', 'hallticketno', 'hallticket']).toUpperCase();
    const studentName = pickField(row, ['studentname', 'name', 'candidatename', 'fullname']);
    const facultyName = pickField(row, ['facultyname', 'faculty', 'instructor', 'staffname']) || String(defaults.facultyName || '').trim();
    const facultyIdCode = pickField(row, ['facultyid', 'facultyidcode', 'facultycode', 'empid', 'employeeid']).toUpperCase() || String(defaults.facultyIdCode || '').trim().toUpperCase();
    const subjectName = pickField(row, ['subjectname', 'subject', 'coursename', 'title']) || String(defaults.subjectName || '').trim();
    const subjectCode = (pickField(row, ['subjectcode', 'coursecode', 'code']) || String(defaults.subjectCode || '')).trim().toUpperCase();
    const rawSec = (pickField(row, ['section', 'sec']) || String(defaults.section || '')).trim().toUpperCase();
    const rawGroup = pickField(row, ['group', 'grp']) || String(defaults.group || '').trim();
    const academicYear = pickField(row, ['academicyear', 'acadyear', 'ay']) || String(defaults.academicYear || '2026-2027').trim();
    const year = pickField(row, ['year', 'studyear']) || String(defaults.year || 'III Year').trim();
    const semester = pickField(row, ['semester', 'sem']) || String(defaults.semester || 'I Semester').trim();
    const department = pickField(row, ['department', 'dept']) || String(defaults.department || 'Computer Science and Engineering').trim();

    if (!regNo || !studentName) {
      rowErrors.push(`Row ${idx + 2}: Missing registration number or student name.`);
      return;
    }

    const section = VALID_SECTIONS.has(rawSec) ? rawSec : '';
    const classification = StudentClassificationService.classifyStudent(regNo);
    const group =
      rawGroup ||
      (['A1', 'A2', 'A3'].includes(section)
        ? 'Group A'
        : ['A4', 'A5', 'A6'].includes(section)
          ? 'Group B'
          : classification.group || 'Group A');

    const mapKey = `${subjectCode || subjectName}__${section || 'UNKNOWN'}__${academicYear}__${semester}__${facultyName}`;
    if (!grouped.has(mapKey)) {
      grouped.set(mapKey, {
        id: `sheet-mapping-${grouped.size + 1}`,
        mappingIndex: grouped.size + 1,
        facultyName,
        facultyIdCode,
        subjectName,
        subjectCode,
        section: section || 'A1',
        group,
        academicYear,
        year,
        semester,
        department,
        sourceFileName: originalName || path.basename(filePath),
        students: [],
        seenRegs: new Set(),
        duplicateRegs: [],
        errors: [],
        warnings: [],
      });
    }

    const entry = grouped.get(mapKey);
    if (!section) {
      entry.errors.push(`Invalid or missing section '${rawSec}' on registration ${regNo} (expected A1-A6).`);
    }
    if (entry.seenRegs.has(regNo)) {
      entry.duplicateRegs.push(regNo);
      return;
    }
    entry.seenRegs.add(regNo);
    entry.students.push({
      sNo: entry.students.length + 1,
      registrationNumber: regNo,
      studentName,
      name: studentName,
      section: section || rawSec || 'A1',
      group,
      year,
    });
  });

  const mappings = Array.from(grouped.values()).map((entry) => {
    const { seenRegs, duplicateRegs, ...rest } = entry;
    if (duplicateRegs.length > 0) {
      rest.warnings.push(`Skipped ${duplicateRegs.length} duplicate registration(s) inside mapping (${duplicateRegs.slice(0, 5).join(', ')}).`);
    }
    if (!rest.facultyName) rest.errors.push('Faculty name is required.');
    if (!rest.subjectName || !rest.subjectCode) rest.errors.push('Subject name and subject code are required.');
    if (rest.students.length === 0) rest.errors.push('No valid student rows found.');
    rest.studentCount = rest.students.length;
    rest.isValid = rest.errors.length === 0;
    return rest;
  });

  const allRegs = new Set();
  const faculties = new Set();
  const subjects = new Set();
  const sections = new Set();
  let totalEnrollments = 0;

  for (const m of mappings) {
    totalEnrollments += m.students.length;
    if (m.facultyName) faculties.add(m.facultyName);
    if (m.subjectName) subjects.add(m.subjectName);
    if (m.section) sections.add(m.section);
    m.students.forEach((s) => allRegs.add(s.registrationNumber));
  }

  return {
    isMultiRoster: mappings.length > 1,
    mappings,
    rowErrors,
    summary: {
      totalPages: 1,
      totalMappings: mappings.length,
      totalStudentEnrollments: totalEnrollments,
      totalUniqueStudents: allRegs.size,
      totalDuplicatesWithinMappings: mappings.reduce((sum, m) => sum + (m.warnings?.length || 0), 0),
      sectionsDetected: Array.from(sections).sort(),
      facultyDetected: Array.from(faculties).sort(),
      subjectsDetected: Array.from(subjects).sort(),
      rowErrorsCount: rowErrors.length,
      rowErrors: rowErrors.slice(0, 20),
    },
  };
}

/**
 * Detects inconsistent student names for the same registrationNumber across uploaded
 * mappings and existing MongoDB Student records.
 */
async function detectInconsistentStudentNames(mappings = []) {
  const namesByReg = new Map();
  for (const m of mappings) {
    for (const s of m.students || []) {
      const reg = String(s.registrationNumber || s.rollNumber || '').trim().toUpperCase();
      const name = String(s.studentName || s.name || '').trim();
      if (!reg || !name) continue;
      if (!namesByReg.has(reg)) namesByReg.set(reg, new Set());
      namesByReg.get(reg).add(name);
    }
  }

  const allRegs = Array.from(namesByReg.keys());
  const dbNameByReg = new Map();
  if (allRegs.length > 0 && Student?.db?.readyState === 1) {
    try {
      const existingStudents = await Student.find({
        registrationNumber: { $in: allRegs },
        examId: { $exists: false },
      })
        .select('registrationNumber name')
        .lean();
      for (const st of existingStudents) {
        if (st.registrationNumber && st.name) {
          dbNameByReg.set(st.registrationNumber.toUpperCase(), st.name.trim());
        }
      }
    } catch {}
  }

  const inconsistentNames = [];
  for (const [reg, nameSet] of namesByReg.entries()) {
    const dbName = dbNameByReg.get(reg);
    const combined = new Set(nameSet);
    if (dbName) combined.add(dbName);
    const normalizedSet = new Set(
      Array.from(combined).map((n) => n.toUpperCase().replace(/\s+/g, ' ').trim())
    );
    if (normalizedSet.size > 1) {
      inconsistentNames.push({
        registrationNumber: reg,
        namesSeen: Array.from(combined),
        existingDbName: dbName || null,
      });
    }
  }

  return inconsistentNames;
}

module.exports = {
  isSpreadsheetFile,
  parseSpreadsheetMappings,
  detectInconsistentStudentNames,
};
