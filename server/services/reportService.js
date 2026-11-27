const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const ReportTemplates = require('../templates/reportTemplates');
const { formatExamTimeRange, normalizeDateStr, formatSessionLabel } = require('../utils/dateTimeUtils');
const { resolveExamType } = require('../utils/examTypeUtils');

const LOGO_PATH = path.join(__dirname, '../assets/rgmcet-logo.jpg');
const DEPT_LOGO_PATH = path.join(__dirname, '../assets/dept-logo-1.png');

class ReportService {
  /**
   * PDF 1: Master Student Allocation Sheet
   */
  static generateMasterPDF(exam, allocation, classroom) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 20, bottom: 20, left: 32, right: 32 },
          bufferPages: true,
        });

        const buffers = [];
        doc.on('data', b => buffers.push(b));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const sortedStudents = [...allocation.students].sort((a, b) => {
          if (a.rowNumber !== b.rowNumber) return a.rowNumber - b.rowNumber;
          if (a.benchNumber !== b.benchNumber) return a.benchNumber - b.benchNumber;
          return a.seatNumber - b.seatNumber;
        });

        const rowsPerPage = 25;
        const totalPages = Math.ceil(sortedStudents.length / rowsPerPage) || 1;

        for (let page = 0; page < totalPages; page++) {
          if (page > 0) doc.addPage();

          this.drawDepartmentHeader(doc, 'EXAMINATION MASTER SEATING ALLOCATION', exam, classroom, sortedStudents.length);

          // Table Header
          let y = 148;
          this.drawTableHeader(doc, y, [
            { text: 'S.No', width: 30, align: 'center' },
            { text: 'Reg. Number', width: 85, align: 'left' },
            { text: 'Student Name', width: 146, align: 'left' },
            { text: 'Sec', width: 45, align: 'center' },
            { text: 'Classroom', width: 110, align: 'center' },
            { text: 'Seat ID', width: 75, align: 'center' },
            { text: 'Set', width: 40, align: 'center' },
          ]);

          y += 20;

          const startIdx = page * rowsPerPage;
          const endIdx = Math.min(startIdx + rowsPerPage, sortedStudents.length);

          for (let i = startIdx; i < endIdx; i++) {
            const s = sortedStudents[i];
            const rowHeight = 22;

            const isEven = (i - startIdx) % 2 === 1;
            if (isEven) {
              doc.rect(32, y, 531, rowHeight).fill('#F8FAFC');
            }
            doc.rect(32, y, 531, rowHeight).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

            doc.fillColor('#14243A').font('Times-Roman').fontSize(8.5);
            doc.text(String(i + 1), 32, y + 6, { width: 30, align: 'center', lineBreak: false });
            doc.font('Times-Bold').text(s.registrationNumber, 62, y + 6, { width: 85, align: 'left', lineBreak: false });
            doc.font('Times-Roman').text(s.name, 147, y + 6, { width: 146, align: 'left', lineBreak: false });
            doc.text(s.section || exam.section || 'A1', 293, y + 6, { width: 45, align: 'center', lineBreak: false });
            doc.text(s.classroomName || classroom.name || 'ET BLOCK', 338, y + 6, { width: 110, align: 'center', lineBreak: false });
            doc.text(s.seatId, 448, y + 6, { width: 75, align: 'center', lineBreak: false });

            // Set badge
            doc.font('Times-Bold');
            if (s.questionPaperSet === 'A') doc.fillColor('#2457A7');
            else if (s.questionPaperSet === 'B') doc.fillColor('#198754');
            else doc.fillColor('#B45309');
            doc.text(s.questionPaperSet, 523, y + 6, { width: 40, align: 'center', lineBreak: false });

            y += rowHeight;
          }

          // Summary footer on last page
          if (page === totalPages - 1) {
            y += 10;
            doc.rect(32, y, 531, 24).fillAndStroke('#F1F5F9', '#CBD5E1');
            doc.fillColor('#14243A').font('Times-Bold').fontSize(8);
            doc.text('SET DISTRIBUTION SUMMARY:', 42, y + 7, { lineBreak: false });
            doc.font('Times-Roman');
            doc.text(`Set A: ${allocation.setDistribution.A} students`, 205, y + 7, { lineBreak: false });
            doc.text(`Set B: ${allocation.setDistribution.B} students`, 310, y + 7, { lineBreak: false });
            doc.text(`Set C: ${allocation.setDistribution.C} students`, 415, y + 7, { lineBreak: false });

            // Official Signature Section
            const sigY = Math.min(y + 44, 762);
            doc.strokeColor('#94A3B8').lineWidth(1);
            doc.moveTo(45, sigY).lineTo(190, sigY).stroke();
            doc.moveTo(220, sigY).lineTo(365, sigY).stroke();
            doc.moveTo(395, sigY).lineTo(540, sigY).stroke();

            doc.fillColor('#475569').fontSize(7.5).font('Times-Roman');
            doc.text('Prepared by (Faculty)', 45, sigY + 4, { width: 145, align: 'center', lineBreak: false });
            doc.text('Verified by (Exam Coordinator)', 220, sigY + 4, { width: 145, align: 'center', lineBreak: false });
            doc.text('Head of the Department (CSE)', 395, sigY + 4, { width: 145, align: 'center', lineBreak: false });
          }
        }

        // Add page numbers
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.page.margins.bottom = 0;
          doc.strokeColor('#CBD5E1').lineWidth(0.5).moveTo(32, 808).lineTo(563, 808).stroke();
          doc.fillColor('#64748B').fontSize(7.5).font('Times-Roman');
          doc.text(
            `RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY (AUTONOMOUS) • CSE DEPT • Page ${i + 1} of ${pages.count}`,
            32,
            814,
            { align: 'center', width: 531, lineBreak: false }
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * PDF 2: Official Department Attendance & Signature Sheet
   * Formatted faithfully according to the Department of CSE official DOCX layout
   * Optimized dynamically for 3-4 pages with zero extra blank pages
   */
  static generateAttendancePDF(exam, allocation, classroom, targetGroup = null) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 20, bottom: 20, left: 32, right: 32 },
          bufferPages: true,
        });

        const buffers = [];
        doc.on('data', b => buffers.push(b));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        let filtered = [...allocation.students];
        if (targetGroup) {
          filtered = filtered.filter(s => (s.group || exam.group || 'Group A') === targetGroup);
        }

        const sortedStudents = filtered.sort((a, b) =>
          a.registrationNumber.localeCompare(b.registrationNumber)
        );

        const rowsPerPage = 25;
        const totalPages = Math.ceil(sortedStudents.length / rowsPerPage) || 1;
        const sheetTitle = 'EXAMINATION ATTENDANCE & SIGNATURE SHEET';

        for (let page = 0; page < totalPages; page++) {
          if (page > 0) doc.addPage();

          this.drawDepartmentHeader(doc, sheetTitle, exam, classroom, sortedStudents.length, { showGroup: false });

          let y = 148;
          this.drawTableHeader(doc, y, [
            { text: 'S.No.', width: 35, align: 'center' },
            { text: 'Registration Number', width: 120, align: 'left' },
            { text: 'Student Name', width: 205, align: 'left' },
            { text: 'Set (A/B/C)', width: 55, align: 'center' },
            { text: 'Signature', width: 116, align: 'center' },
          ]);

          y += 20;

          const startIdx = page * rowsPerPage;
          const endIdx = Math.min(startIdx + rowsPerPage, sortedStudents.length);

          for (let i = startIdx; i < endIdx; i++) {
            const s = sortedStudents[i];
            const rowHeight = 22;

            const isEven = (i - startIdx) % 2 === 1;
            if (isEven) {
              doc.rect(32, y, 531, rowHeight).fill('#F8FAFC');
            }
            doc.rect(32, y, 531, rowHeight).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

            doc.fillColor('#14243A').font('Times-Roman').fontSize(8.5);
            doc.text(String(i + 1), 32, y + 6, { width: 35, align: 'center', lineBreak: false });
            doc.font('Times-Bold').text(s.registrationNumber, 67, y + 6, { width: 120, align: 'left', lineBreak: false });
            doc.font('Times-Roman').text(s.name, 187, y + 6, { width: 205, align: 'left', lineBreak: false });

            // Set badge
            doc.font('Times-Bold');
            if (s.questionPaperSet === 'A') doc.fillColor('#2457A7');
            else if (s.questionPaperSet === 'B') doc.fillColor('#198754');
            else doc.fillColor('#B45309');
            doc.text(s.questionPaperSet || 'A', 392, y + 6, { width: 55, align: 'center', lineBreak: false });

            // Signature line
            doc.strokeColor('#CBD5E1').lineWidth(0.5);
            doc.moveTo(455, y + 17).lineTo(555, y + 17).dash(2, { space: 2 }).stroke();
            doc.undash();

            y += rowHeight;
          }

          if (page === totalPages - 1) {
            const sigY = Math.min(y + 24, 762);
            doc.strokeColor('#94A3B8').lineWidth(1);
            doc.moveTo(45, sigY).lineTo(190, sigY).stroke();
            doc.moveTo(220, sigY).lineTo(365, sigY).stroke();
            doc.moveTo(395, sigY).lineTo(540, sigY).stroke();

            doc.fillColor('#475569').fontSize(7.5).font('Times-Roman');
            doc.text('Signature of Room Invigilator', 45, sigY + 4, { width: 145, align: 'center', lineBreak: false });
            doc.text('Signature of Chief Superintendent', 220, sigY + 4, { width: 145, align: 'center', lineBreak: false });
            doc.text('Head of the Department (CSE)', 395, sigY + 4, { width: 145, align: 'center', lineBreak: false });
          }
        }

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.page.margins.bottom = 0;
          doc.strokeColor('#CBD5E1').lineWidth(0.5).moveTo(32, 808).lineTo(563, 808).stroke();
          doc.fillColor('#64748B').fontSize(7.5).font('Times-Roman');
          doc.text(
            `RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY (AUTONOMOUS) • CSE DEPT • Page ${i + 1} of ${pages.count} • Official Attendance Record`,
            32,
            814,
            { align: 'center', width: 531, lineBreak: false }
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  static generateSignatureSheetPDF(exam, allocation, classroom) {
    return this.generateAttendancePDF(exam, allocation, classroom);
  }

  /**
   * PDF 2b: Dedicated Faculty & Section Attendance & Signature Sheet
   * Generated automatically for each child section in a centralized examination
   * Columns: S.No., Registration Number, Student Name, Set (A/B/C), Signature
   * NO Group column, NO FDH roll number
   */
  static generateFacultySectionAttendancePDF(exam, sectionAlloc, students, classroom) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 20, bottom: 20, left: 32, right: 32 },
          bufferPages: true,
        });

        const buffers = [];
        doc.on('data', (b) => buffers.push(b));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const sortedStudents = [...(students || [])].sort((a, b) =>
          (a.registrationNumber || '').localeCompare(b.registrationNumber || '')
        );

        const rowsPerPage = 25;
        const totalPages = Math.ceil(sortedStudents.length / rowsPerPage) || 1;
        const sheetTitle = 'EXAMINATION ATTENDANCE & SIGNATURE SHEET';

        // Custom exam context tailored for this section and faculty
        const sectionExamContext = {
          examName: exam.examName,
          examType: resolveExamType(exam),
          academicYear: exam.academicYear,
          year: exam.year,
          semester: exam.semester,
          subjectName: exam.subjectName,
          subjectCode: exam.subjectCode,
          facultyName: sectionAlloc.facultyName || exam.facultyName || 'CSE Faculty',
          section: sectionAlloc.section,
          examDate: exam.examDate,
          startTime: exam.startTime,
          endTime: exam.endTime,
          session: exam.session,
          studentCount: sortedStudents.length,
        };

        const sectionClassroom = {
          name: sectionAlloc.classroomName || classroom?.name || 'ET BLOCK 3020',
          roomNumber: sectionAlloc.roomNumber || classroom?.roomNumber || '3020',
        };

        for (let page = 0; page < totalPages; page++) {
          if (page > 0) doc.addPage();

          this.drawDepartmentHeader(
            doc,
            sheetTitle,
            sectionExamContext,
            sectionClassroom,
            sortedStudents.length,
            { showGroup: false }
          );

          let y = 148;
          this.drawTableHeader(doc, y, [
            { text: 'S.No.', width: 35, align: 'center' },
            { text: 'Registration Number', width: 120, align: 'left' },
            { text: 'Student Name', width: 205, align: 'left' },
            { text: 'Set (A/B/C)', width: 55, align: 'center' },
            { text: 'Signature', width: 116, align: 'center' },
          ]);

          y += 20;

          const startIdx = page * rowsPerPage;
          const endIdx = Math.min(startIdx + rowsPerPage, sortedStudents.length);

          for (let i = startIdx; i < endIdx; i++) {
            const s = sortedStudents[i];
            const rowHeight = 22;

            const isEven = (i - startIdx) % 2 === 1;
            if (isEven) {
              doc.rect(32, y, 531, rowHeight).fill('#F8FAFC');
            }
            doc.rect(32, y, 531, rowHeight).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

            doc.fillColor('#14243A').font('Times-Roman').fontSize(8.5);
            doc.text(String(i + 1), 32, y + 6, { width: 35, align: 'center', lineBreak: false });
            doc.font('Times-Bold').text(s.registrationNumber, 67, y + 6, { width: 120, align: 'left', lineBreak: false });
            doc.font('Times-Roman').text(s.name || s.studentName, 187, y + 6, { width: 205, align: 'left', lineBreak: false });

            // Set badge
            doc.font('Times-Bold');
            const qSet = s.questionPaperSet || 'A';
            if (qSet === 'A') doc.fillColor('#2457A7');
            else if (qSet === 'B') doc.fillColor('#198754');
            else doc.fillColor('#B45309');
            doc.text(qSet, 392, y + 6, { width: 55, align: 'center', lineBreak: false });

            // Signature line
            doc.strokeColor('#CBD5E1').lineWidth(0.5);
            doc.moveTo(455, y + 17).lineTo(555, y + 17).dash(2, { space: 2 }).stroke();
            doc.undash();

            y += rowHeight;
          }

          if (page === totalPages - 1) {
            const sigY = Math.min(y + 24, 762);
            doc.strokeColor('#94A3B8').lineWidth(1);
            doc.moveTo(45, sigY).lineTo(190, sigY).stroke();
            doc.moveTo(220, sigY).lineTo(365, sigY).stroke();
            doc.moveTo(395, sigY).lineTo(540, sigY).stroke();

            doc.fillColor('#475569').fontSize(7.5).font('Times-Roman');
            doc.text(`Faculty Invigilator (${sectionAlloc.facultyName || 'Faculty'})`, 45, sigY + 4, {
              width: 145,
              align: 'center',
              lineBreak: false,
            });
            doc.text('Signature of Chief Superintendent', 220, sigY + 4, {
              width: 145,
              align: 'center',
              lineBreak: false,
            });
            doc.text('Head of the Department (CSE)', 395, sigY + 4, {
              width: 145,
              align: 'center',
              lineBreak: false,
            });
          }
        }

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.page.margins.bottom = 0;
          doc.strokeColor('#CBD5E1').lineWidth(0.5).moveTo(32, 808).lineTo(563, 808).stroke();
          doc.fillColor('#64748B').fontSize(7.5).font('Times-Roman');
          doc.text(
            `RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY (AUTONOMOUS) • CSE DEPT • Sec ${sectionAlloc.section} • Page ${i + 1} of ${pages.count} • Official Attendance Record`,
            32,
            814,
            { align: 'center', width: 531, lineBreak: false }
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Combine multiple section attendance PDFs into a single ZIP archive
   * @param {Object} exam
   * @param {Array<{ filename: string, buffer: Buffer }>} sectionPdfs
   * @returns {Promise<Buffer>}
   */
  static generateCentralizedZip(exam, sectionPdfs) {
    return new Promise((resolve, reject) => {
      try {
        let archive;
        if (typeof archiver === 'function') {
          archive = archiver('zip', { zlib: { level: 9 } });
        } else if (archiver.ZipArchive) {
          archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        } else {
          archive = new archiver({ zlib: { level: 9 } });
        }
        const buffers = [];

        archive.on('data', (data) => buffers.push(data));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', (err) => reject(err));

        for (const item of sectionPdfs) {
          archive.append(item.buffer, { name: item.filename });
        }

        archive.finalize();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * PDF 3: Classroom Seating Chart (Top-down visual blueprint)
   */
  static generateSeatingChartPDF(exam, allocation, classroom) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margins: { top: 20, bottom: 20, left: 24, right: 24 },
          bufferPages: true,
        });

        const buffers = [];
        doc.on('data', b => buffers.push(b));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const seatStudentMap = new Map();
        allocation.students.forEach(s => {
          if (s.seatId) seatStudentMap.set(s.seatId, s);
          if (s.rowNumber && s.benchNumber && s.seatNumber) {
            seatStudentMap.set(`R${s.rowNumber}-B${s.benchNumber}-S${s.seatNumber}`, s);
          }
        });

        // Landscape Header
        // College Crest on Left
        if (fs.existsSync(LOGO_PATH)) {
          try {
            doc.image(LOGO_PATH, 28, 16, { fit: [46, 46] });
          } catch (e) {
            console.error('Logo render error:', e.message);
          }
        }
        // CSE Department Logo on Right
        if (fs.existsSync(DEPT_LOGO_PATH)) {
          try {
            doc.image(DEPT_LOGO_PATH, 768, 16, { fit: [46, 46] });
          } catch (e) {
            console.error('Dept logo render error:', e.message);
          }
        }

        // Center Title Block
        doc.fillColor('#C00000').font('Times-Bold').fontSize(12).text(
          'RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY',
          80,
          16,
          { align: 'center', width: 680, lineBreak: false }
        );
        doc.fontSize(8.5).font('Times-Bold').fillColor('#14243A').text(
          '(AUTONOMOUS)',
          80,
          30,
          { align: 'center', width: 680, lineBreak: false }
        );
        doc.fontSize(10).font('Times-Bold').fillColor('#00AE50').text(
          'DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING',
          80,
          42,
          { align: 'center', width: 680, lineBreak: false }
        );
        doc.fontSize(9.5).font('Times-Bold').fillColor('#14243A').text(
          'EXAMINATION HALL SEATING CHART & QUESTION PAPER DISTRIBUTION',
          80,
          56,
          { align: 'center', width: 680, lineBreak: false }
        );

        // Metadata box
        doc.rect(26, 72, 790, 36).fillAndStroke('#F8FAFC', '#CBD5E1');
        doc.fillColor('#334155').fontSize(8).font('Times-Roman');
        doc.text(`Subject: ${exam.subjectName} (${exam.subjectCode})`, 40, 78, { lineBreak: false });
        doc.text(`Date & Time: ${normalizeDateStr(exam.examDate) || exam.examDate} (${formatExamTimeRange(exam)})`, 40, 91, { lineBreak: false });
        doc.text(`Exam: ${exam.examName} [${resolveExamType(exam)}] | Session: ${formatSessionLabel(exam.session, exam.startTime)} | Sec: ${exam.section || 'A1'}`, 310, 78, { width: 280, lineBreak: false, ellipsis: true });
        doc.text(`Classroom: ${classroom.name || 'ET BLOCK 3020'} (${classroom.roomNumber || '3020'})`, 310, 91, { lineBreak: false });
        doc.text(`Total Candidates: ${allocation.students.length}`, 600, 78, { lineBreak: false });
        doc.text(`Sets: A (${allocation.setDistribution.A}) | B (${allocation.setDistribution.B}) | C (${allocation.setDistribution.C})`, 600, 91, { lineBreak: false });

        // Blackboard / Screen Indicator at front
        doc.rect(260, 114, 320, 15).fillAndStroke('#14243A', '#14243A');
        doc.fillColor('#FFFFFF').fontSize(8).font('Times-Bold').text(
          'BLACKBOARD / INSTRUCTOR STAGE (FRONT)',
          260,
          118,
          { align: 'center', width: 320, lineBreak: false }
        );

        let currentY = 136;

        if (classroom.rows && classroom.rows.length > 0) {
          classroom.rows.forEach(row => {
            doc.fillColor('#1E293B').font('Times-Bold').fontSize(8.5).text(
              `ROW ${row.rowNumber}`,
              30,
              currentY + 12,
              { lineBreak: false }
            );

            let benchX = 90;
            const benches = row.benches || [];

            benches.forEach(bench => {
              const seats = bench.seats || [];
              const benchWidth = seats.length * 28 + 6;
              const benchHeight = 44;

              doc.rect(benchX, currentY, benchWidth, benchHeight).fillAndStroke('#FFFFFF', '#CBD5E1');

              doc.fillColor('#64748B').fontSize(7).font('Times-Bold').text(
                `B${bench.benchNumber}`,
                benchX + 2,
                currentY + 2,
                { lineBreak: false }
              );

              seats.forEach((seat, seatIdx) => {
                const seatX = benchX + 4 + seatIdx * 28;
                const seatY = currentY + 12;
                const seatW = 26;
                const seatH = 28;

                const assigned = seatStudentMap.get(seat.seatId);

                let bgCol = '#F1F5F9';
                let strokeCol = '#94A3B8';
                let badgeText = '';

                if (assigned) {
                  if (assigned.questionPaperSet === 'A') {
                    bgCol = '#DBEAFE';
                    strokeCol = '#2457A7';
                    badgeText = 'A';
                  } else if (assigned.questionPaperSet === 'B') {
                    bgCol = '#D1FAE5';
                    strokeCol = '#198754';
                    badgeText = 'B';
                  } else {
                    bgCol = '#FEF3C7';
                    strokeCol = '#D97706';
                    badgeText = 'C';
                  }
                } else if (!seat.isAvailable) {
                  bgCol = '#FEE2E2';
                  strokeCol = '#EF4444';
                  badgeText = 'X';
                }

                doc.rect(seatX, seatY, seatW, seatH).fillAndStroke(bgCol, strokeCol);

                if (assigned) {
                  const shortReg = assigned.registrationNumber.slice(-4);
                  doc.fillColor('#0F172A').fontSize(6).font('Times-Bold').text(
                    shortReg,
                    seatX,
                    seatY + 4,
                    { width: seatW, align: 'center', lineBreak: false }
                  );
                  doc.fillColor(strokeCol).fontSize(7.5).font('Times-Bold').text(
                    assigned.questionPaperSet,
                    seatX,
                    seatY + 14,
                    { width: seatW, align: 'center', lineBreak: false }
                  );
                } else {
                  doc.fillColor('#94A3B8').fontSize(6.5).font('Times-Roman').text(
                    badgeText || 'Empty',
                    seatX,
                    seatY + 10,
                    { width: seatW, align: 'center', lineBreak: false }
                  );
                }
              });

              benchX += benchWidth + 10;
            });

            currentY += 50;
          });
        }

        // Color Legend and Invigilator Sign-off Box at bottom
        const legendY = 530;
        doc.rect(26, legendY, 790, 38).fillAndStroke('#F8FAFC', '#CBD5E1');

        doc.fillColor('#1E293B').font('Times-Bold').fontSize(8).text(
          'QUESTION PAPER SET LEGEND:',
          40,
          legendY + 8,
          { lineBreak: false }
        );

        // Set A pill
        doc.rect(165, legendY + 5, 60, 14).fillAndStroke('#DBEAFE', '#2457A7');
        doc.fillColor('#1E40AF').fontSize(7).font('Times-Bold').text('SET A (Blue)', 165, legendY + 8, { width: 60, align: 'center', lineBreak: false });

        // Set B pill
        doc.rect(240, legendY + 5, 60, 14).fillAndStroke('#D1FAE5', '#198754');
        doc.fillColor('#065F46').fontSize(7).font('Times-Bold').text('SET B (Green)', 240, legendY + 8, { width: 60, align: 'center', lineBreak: false });

        // Set C pill
        doc.rect(315, legendY + 5, 60, 14).fillAndStroke('#FEF3C7', '#D97706');
        doc.fillColor('#92400E').fontSize(7).font('Times-Bold').text('SET C (Amber)', 315, legendY + 8, { width: 60, align: 'center', lineBreak: false });

        doc.fillColor('#475569').fontSize(7.5).font('Times-Roman').text(
          'Notice: Seating follows strict randomized bench alternation. Invigilators must verify candidate ID and question paper set code before distribution.',
          40,
          legendY + 23,
          { lineBreak: false }
        );

        // Invigilator signature
        doc.strokeColor('#94A3B8').lineWidth(1);
        doc.moveTo(630, legendY + 20).lineTo(780, legendY + 20).stroke();
        doc.fontSize(7).font('Times-Roman').text('Invigilator Verification Signature', 630, legendY + 23, { width: 150, align: 'center', lineBreak: false });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Helper: Official Department Header with Crest and CSE Logo (delegated to ReportTemplates)
   */
  static drawDepartmentHeader(doc, title, exam, classroom, totalStudents, options = {}) {
    return ReportTemplates.drawDepartmentHeader(doc, title, exam, classroom, totalStudents, options);
  }

  static drawTableHeader(doc, y, columns) {
    return ReportTemplates.drawTableHeader(doc, y, columns);
  }
}

module.exports = ReportService;