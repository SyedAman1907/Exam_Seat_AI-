const path = require('path');
const fs = require('fs');
const { formatExamTimeRange, normalizeDateStr, formatSessionLabel } = require('../utils/dateTimeUtils');

const LOGO_PATH = path.join(__dirname, '../assets/rgmcet-logo.jpg');
const DEPT_LOGO_PATH = path.join(__dirname, '../assets/dept-logo-1.png');

/**
 * Standardized Academic Report Templates
 * Department of Computer Science & Engineering, RGMCET (Autonomous)
 */
class ReportTemplates {
  /**
   * Draw the official College & Department header
   */
  static drawDepartmentHeader(doc, title, exam, classroom, totalStudents, options = {}) {
    // Official RGMCET Crest (Left)
    if (fs.existsSync(LOGO_PATH)) {
      try {
        doc.image(LOGO_PATH, 32, 20, { fit: [44, 44] });
      } catch (e) {
        // Fallback silently if asset is unreadable
      }
    }

    // Official Department Logo (Right)
    if (fs.existsSync(DEPT_LOGO_PATH)) {
      try {
        doc.image(DEPT_LOGO_PATH, 519, 20, { fit: [44, 44] });
      } catch (e) {
        // Fallback silently
      }
    }

    const textX = 80;
    const textW = 435;

    // Line 1: College Name
    doc.fillColor('#C00000').font('Times-Bold').fontSize(10.5).text(
      'RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY',
      textX,
      20,
      { align: 'center', width: textW, lineBreak: false }
    );

    // Line 2: Autonomous
    doc.fontSize(8).font('Times-Bold').fillColor('#14243A').text(
      '(AUTONOMOUS)',
      textX,
      34,
      { align: 'center', width: textW, lineBreak: false }
    );

    // Line 3: Department Name
    doc.fontSize(9.5).font('Times-Bold').fillColor('#00AE50').text(
      'DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING',
      textX,
      45,
      { align: 'center', width: textW, lineBreak: false }
    );

    // Line 4: Document Title
    doc.fontSize(9.5).font('Times-Bold').fillColor('#14243A').text(
      title,
      textX,
      58,
      { align: 'center', width: textW, lineBreak: false }
    );

    // Header dividing accents
    doc.strokeColor('#CBD5E1').lineWidth(0.75).moveTo(32, 73).lineTo(563, 73).stroke();
    doc.strokeColor('#00AE50').lineWidth(1.25).moveTo(32, 75).lineTo(563, 75).stroke();

    // Exam Info Box
    doc.rect(32, 80, 531, 58).fillAndStroke('#F8FAFC', '#CBD5E1');
    doc.fontSize(8.5).font('Times-Roman').fillColor('#334155');

    // Left column: Width strictly bounded to 265 to prevent any overlap
    doc.text(`Examination: ${exam.examName || 'University Examination'}`, 42, 86, { width: 265, lineBreak: false, ellipsis: true });
    doc.text(`Academic Year: ${exam.academicYear || '2026-2027'} | Year & Sem: ${exam.year || 'III Year'} - ${exam.semester || 'I Semester'}`, 42, 99, { width: 265, lineBreak: false, ellipsis: true });
    doc.text(`Subject: ${exam.subjectName} (${exam.subjectCode})`, 42, 112, { width: 265, lineBreak: false, ellipsis: true });
    doc.text(`Section: ${exam.section || 'A1'} | Faculty: ${exam.facultyName || 'CSE Faculty'}`, 42, 125, { width: 265, lineBreak: false, ellipsis: true });

    // Right column: Width strictly bounded to 240 starting cleanly at x: 315
    const formattedDate = normalizeDateStr(exam.examDate) || exam.examDate;
    const formattedRange = formatExamTimeRange(exam);
    doc.text(`Exam Date: ${formattedDate} | Time: ${formattedRange}`, 315, 86, { width: 240, lineBreak: false, ellipsis: true });
    doc.text(`Session: ${formatSessionLabel(exam.session, exam.startTime)} | Room: ${classroom.roomNumber || '3010'}`, 315, 99, { width: 240, lineBreak: false, ellipsis: true });
    doc.text(`Classroom: ${classroom.name || 'ET BLOCK 3010'} (Room ${classroom.roomNumber || '3010'})`, 315, 112, { width: 240, lineBreak: false, ellipsis: true });

    const isAttendanceOrSignature =
      options.showGroup === false ||
      (typeof title === 'string' && (title.includes('ATTENDANCE') || title.includes('SIGNATURE')));

    doc.font('Times-Bold').fillColor('#1E40AF');
    if (isAttendanceOrSignature) {
      doc.text(`Total Candidates: ${totalStudents || exam.studentCount || 0}`, 315, 125, { width: 240, lineBreak: false });
    } else {
      doc.text(`Group: ${exam.group || 'Group A'} | Candidates: ${totalStudents || exam.studentCount || 0}`, 315, 125, { width: 240, lineBreak: false });
    }
  }

  /**
   * Draw table headers
   */
  static drawTableHeader(doc, y, columns, startX = 32, totalWidth = 531) {
    doc.rect(startX, y, totalWidth, 20).fillAndStroke('#14243A', '#14243A');
    doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(8.5);

    let currentX = startX;
    columns.forEach(col => {
      doc.text(col.text, currentX, y + 6, { width: col.width, align: col.align || 'left', lineBreak: false });
      currentX += col.width;
    });
  }
}

module.exports = ReportTemplates;
