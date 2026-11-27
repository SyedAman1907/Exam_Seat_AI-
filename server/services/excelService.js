const ExcelJS = require('exceljs');
const { formatExamTimeRange, normalizeDateStr, formatSessionLabel, getTodayKolkataDate } = require('../utils/dateTimeUtils');
const { resolveExamType } = require('../utils/examTypeUtils');

class ExcelService {
  /**
   * 1. Student Master Data Excel (Structured Database Export)
   * Columns: S.No | Roll Number | Student Name | Faculty Name | Section | Subject Name | Group | A1 | A2 | A3 | A4 | A5 | A6
   */
  static async generateMasterStudentsExcel(students, title = 'STUDENT MASTER DATABASE') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ExamSeat AI — RGMCET CSE';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Student Master Data', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    // College & Dept Title Banner
    sheet.mergeCells('A1:M1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY (AUTONOMOUS)';
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14243A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 26;

    sheet.mergeCells('A2:M2');
    const subCell = sheet.getCell('A2');
    subCell.value = `DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING — ${title}`;
    subCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF008000' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    sheet.mergeCells('A3:M3');
    const metaCell = sheet.getCell('A3');
    metaCell.value = `Total Records: ${students.length} | Export Date: ${getTodayKolkataDate().dmy} IST | RGMCET Autonomous Examination System`;
    metaCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF475569' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(3).height = 18;

    // Header Row (Row 4)
    const headerRow = sheet.getRow(4);
    headerRow.values = [
      'S.No',
      'Roll Number',
      'Student Name',
      'Faculty Name',
      'Section',
      'Subject Name',
      'Group',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
    ];
    headerRow.height = 24;
    headerRow.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    for (let c = 1; c <= 13; c++) {
      const cell = headerRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    }

    students.forEach((s, idx) => {
      const isEven = idx % 2 === 1;
      const rowBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

      const row = sheet.addRow([
        idx + 1,
        s.rollNumber || s.registrationNumber,
        s.studentName || s.name,
        s.facultyName || 'CSE Faculty',
        s.section || 'A',
        s.subjectName || s.subject || '',
        s.group || 'Group A',
        s.a1 || '',
        s.a2 || '',
        s.a3 || '',
        s.a4 || '',
        s.a5 || '',
        s.a6 || '',
      ]);

      row.height = 20;
      row.font = { name: 'Calibri', size: 9.5 };

      for (let c = 1; c <= 13; c++) {
        const cell = row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        // Alignments
        if ([1, 5, 7, 8, 9, 10, 11, 12, 13].includes(c)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        }
      }
    });

    // Auto fit column widths
    const widths = [8, 16, 28, 22, 10, 26, 12, 8, 8, 8, 8, 8, 8];
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });

    return await workbook.xlsx.writeBuffer();
  }

  /**
   * 2. Subject-wise Student List Excel
   */
  static async generateSubjectWiseExcel(subjectName, students) {
    return this.generateMasterStudentsExcel(students, `SUBJECT ENROLLMENT LIST — ${subjectName.toUpperCase()}`);
  }

  /**
   * 3. Faculty-wise Student List Excel
   */
  static async generateFacultyWiseExcel(facultyName, students) {
    return this.generateMasterStudentsExcel(students, `FACULTY STUDENT ROSTER — ${facultyName.toUpperCase()}`);
  }

  /**
   * Multi-tab Excel workbook for exam allocation
   */
  static async generateAllocationWorkbook(exam, allocation, classroom) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ExamSeat AI — Autonomous Examination Seating System';
    workbook.created = new Date();

    const sortedStudents = [...allocation.students].sort((a, b) => {
      if (a.rowNumber !== b.rowNumber) return a.rowNumber - b.rowNumber;
      if (a.benchNumber !== b.benchNumber) return a.benchNumber - b.benchNumber;
      return a.seatNumber - b.seatNumber;
    });

    // 1. Master Sheet
    this.createSheet(workbook, 'Master Allocation', sortedStudents, exam, classroom);

    // 2. Set A Sheet
    const setAStudents = sortedStudents.filter(s => s.questionPaperSet === 'A');
    this.createSheet(workbook, 'Set A Students', setAStudents, exam, classroom, 'Set A');

    // 3. Set B Sheet
    const setBStudents = sortedStudents.filter(s => s.questionPaperSet === 'B');
    this.createSheet(workbook, 'Set B Students', setBStudents, exam, classroom, 'Set B');

    // 4. Set C Sheet
    const setCStudents = sortedStudents.filter(s => s.questionPaperSet === 'C');
    this.createSheet(workbook, 'Set C Students', setCStudents, exam, classroom, 'Set C');

    return await workbook.xlsx.writeBuffer();
  }

  static createSheet(workbook, sheetName, students, exam, classroom, setFilter = null) {
    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 5 }],
    });

    // Title Row
    sheet.mergeCells('A1:K1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY';
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14243A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 26;

    // Subtitle Row
    sheet.mergeCells('A2:K2');
    const subCell = sheet.getCell('A2');
    subCell.value = `EXAMINATION SEATING ALLOCATION REPORT — ${exam.examName.toUpperCase()} [${resolveExamType(exam)}] [${exam.group || 'Group A'}] ${setFilter ? `(${setFilter.toUpperCase()})` : ''}`;
    subCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF2563EB' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    // Metadata Row
    sheet.mergeCells('A3:K3');
    const metaCell1 = sheet.getCell('A3');
    metaCell1.value = `Subject: ${exam.subjectName} (${exam.subjectCode}) | Date: ${normalizeDateStr(exam.examDate) || exam.examDate} | Time: ${formatExamTimeRange(exam)} (${formatSessionLabel(exam.session, exam.startTime)}) | Faculty: ${exam.facultyName || 'CSE Faculty'} | Classroom: ${classroom.name} (${classroom.roomNumber})`;
    metaCell1.font = { name: 'Calibri', size: 9.5, italic: true };
    metaCell1.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(3).height = 18;

    sheet.mergeCells('A4:K4');
    const metaCell2 = sheet.getCell('A4');
    metaCell2.value = `Group: ${exam.group || 'Group A'} | Total Candidates: ${students.length} | Generated: ${getTodayKolkataDate().dmy} IST`;
    metaCell2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
    metaCell2.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(4).height = 16;

    // Table Column Headers (Row 5)
    const headerRow = sheet.getRow(5);
    headerRow.values = [
      'S.No',
      'Roll Number',
      'Student Name',
      'Section',
      'Classroom',
      'Subject',
      'Row',
      'Bench',
      'Seat ID',
      'Set',
      'Candidate Signature',
    ];

    headerRow.height = 24;
    headerRow.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    for (let col = 1; col <= 11; col++) {
      const cell = headerRow.getCell(col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    }

    students.forEach((s, idx) => {
      const row = sheet.addRow([
        idx + 1,
        s.registrationNumber,
        s.name,
        s.section || exam.section || 'A1',
        s.classroomName || classroom.name,
        exam.subjectCode,
        `Row ${s.rowNumber}`,
        `Bench ${s.benchNumber}`,
        s.seatId,
        s.questionPaperSet,
        '',
      ]);

      row.height = 20;
      row.font = { name: 'Calibri', size: 9.5 };

      const isEven = idx % 2 === 1;
      const rowBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

      for (let col = 1; col <= 11; col++) {
        const cell = row.getCell(col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        if ([1, 4, 5, 6, 7, 8, 9, 10].includes(col)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        }
      }
    });

    const widths = [8, 18, 28, 10, 18, 14, 12, 12, 16, 10, 24];
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
  }
}

module.exports = ExcelService;
