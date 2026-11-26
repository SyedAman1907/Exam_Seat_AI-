const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const Allocation = require('../models/Allocation');
const StudentEnrollment = require('../models/StudentEnrollment');
const Student = require('../models/Student');
const ReportService = require('../services/reportService');
const ExcelService = require('../services/excelService');
const AuditLog = require('../models/AuditLog');

function sendBinaryReport(res, buffer, contentType, filename) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(buffer);
}

// Helper to fetch exam context
async function getReportContext(examId) {
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    const err = new Error('Invalid examination ID.');
    err.statusCode = 400;
    throw err;
  }

  const exam = await Exam.findById(examId).lean();
  if (!exam || exam.isDeleted) {
    const err = new Error('Examination not found.');
    err.statusCode = 404;
    throw err;
  }

  const allocation = await Allocation.findOne({ examId, isCurrent: true }).lean();
  if (!allocation) {
    const err = new Error('No seating allocation found. Please generate an allocation first.');
    err.statusCode = 404;
    throw err;
  }

  let classroom = null;
  const targetRoomId = exam.classroomId || allocation.classroomId || exam.sectionAllocations?.[0]?.classroomId;
  if (targetRoomId) {
    classroom = await Classroom.findById(targetRoomId).lean();
  }
  if (!classroom && exam.sectionAllocations?.[0]?.roomNumber) {
    classroom = await Classroom.findOne({
      roomNumber: exam.sectionAllocations[0].roomNumber,
      isActive: true,
    }).lean();
  }
  if (!classroom) {
    classroom = await Classroom.findOne({ roomNumber: '3010', isActive: true }).lean();
  }
  if (!classroom) {
    classroom = {
      name: exam.sectionAllocations?.[0]?.classroomName || 'ET BLOCK 3020',
      roomNumber: exam.sectionAllocations?.[0]?.roomNumber || '3020',
      rows: [],
    };
  }

  return { exam, allocation, classroom };
}

// @desc    1. Download Master Student Data Excel
// @route   GET /api/reports/master-students-excel
// @access  Private
exports.getMasterStudentsExcel = async (req, res) => {
  try {
    const { subject, section, faculty, group } = req.query;
    const filter = {};
    if (subject && subject !== 'all') filter.subjectName = { $regex: new RegExp(`^${subject.trim()}$`, 'i') };
    if (section && section !== 'all') filter.section = section.trim().toUpperCase();
    if (faculty && faculty !== 'all') filter.facultyName = { $regex: new RegExp(faculty.trim(), 'i') };
    if (group && group !== 'all') filter.group = group.trim();

    const selectFields = 'rollNumber registrationNumber studentName name facultyName section subjectName subject group a1 a2 a3 a4 a5 a6';
    let students = await StudentEnrollment.find(filter)
      .select(selectFields)
      .sort({ section: 1, group: 1, rollNumber: 1 })
      .lean();
    if (!students || students.length === 0) {
      students = await Student.find({ examId: { $exists: false } })
        .select(selectFields)
        .sort({ section: 1, group: 1, registrationNumber: 1 })
        .lean();
    }

    const excelBuffer = await ExcelService.generateMasterStudentsExcel(students, 'STUDENT MASTER DATABASE');
    const filename = `RGMCET_CSE_Student_Master_Database_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    2. Download Subject-Wise Student List Excel
// @route   GET /api/reports/subject-wise-excel
// @access  Private
exports.getSubjectWiseExcel = async (req, res) => {
  try {
    const { subject } = req.query;
    if (!subject) {
      return res.status(400).json({ success: false, message: 'Subject name parameter is required.' });
    }

    const students = await StudentEnrollment.find({
      subjectName: { $regex: new RegExp(`^${subject.trim()}$`, 'i') },
    })
      .select('rollNumber studentName facultyName section subjectName group a1 a2 a3 a4 a5 a6')
      .sort({ section: 1, group: 1, rollNumber: 1 })
      .lean();

    const excelBuffer = await ExcelService.generateSubjectWiseExcel(subject, students);
    const filename = `Subject_Students_${subject.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    3. Download Faculty-Wise Student List Excel
// @route   GET /api/reports/faculty-wise-excel
// @access  Private
exports.getFacultyWiseExcel = async (req, res) => {
  try {
    const { faculty } = req.query;
    if (!faculty) {
      return res.status(400).json({ success: false, message: 'Faculty name parameter is required.' });
    }

    const students = await StudentEnrollment.find({
      facultyName: { $regex: new RegExp(faculty.trim(), 'i') },
    })
      .select('rollNumber studentName facultyName section subjectName group a1 a2 a3 a4 a5 a6')
      .sort({ section: 1, group: 1, rollNumber: 1 })
      .lean();

    const excelBuffer = await ExcelService.generateFacultyWiseExcel(faculty, students);
    const filename = `Faculty_Students_${faculty.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.send(excelBuffer);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    4 & 5. Download Group A or Group B Attendance Sheet PDF
// @route   GET /api/exams/:id/reports/group-attendance-pdf
// @access  Private
exports.getGroupAttendancePDF = async (req, res) => {
  try {
    const { group } = req.query; // 'Group A' or 'Group B'
    const { exam, allocation, classroom } = await getReportContext(req.params.id);
    const targetGroup = group || exam.group || 'Group A';

    const pdfBuffer = await ReportService.generateAttendancePDF(exam, allocation, classroom, targetGroup);
    const safeGroup = targetGroup.replace(/\s+/g, '_');
    const filename = `Attendance_Sheet_${safeGroup}_${exam.subjectCode}_${exam.examDate.replace(/-/g, '')}.pdf`;

    sendBinaryReport(res, pdfBuffer, 'application/pdf', filename);
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// @desc    6. Download Classroom Seating Chart PDF
// @route   GET /api/exams/:id/reports/seating-pdf
// @access  Private
exports.getSeatingPDF = async (req, res) => {
  try {
    const { exam, allocation, classroom } = await getReportContext(req.params.id);
    const pdfBuffer = await ReportService.generateSeatingChartPDF(exam, allocation, classroom);

    const filename = `Seating_Layout_Chart_${exam.subjectCode}_${exam.examDate.replace(/-/g, '')}.pdf`;

    sendBinaryReport(res, pdfBuffer, 'application/pdf', filename);
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// @desc    Download Section-specific Attendance PDF in Centralized Examination
// @route   GET /api/reports/:id/section-attendance-pdf/:section
// @route   GET /api/exams/:id/reports/section-attendance-pdf/:section
// @access  Private
exports.getSectionAttendancePDF = async (req, res) => {
  try {
    const { id, section } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid examination ID.' });
    }
    const exam = await Exam.findById(id).populate('classroomId').lean();
    if (!exam || exam.isDeleted) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    const targetSection = (section || req.query.section || req.query.sec || 'A1').trim().toUpperCase();
    let sectionAlloc = (exam.sectionAllocations || []).find((s) => s.section === targetSection);

    // If not found in sectionAllocations or legacy single exam, construct a fallback sectionAlloc
    if (!sectionAlloc) {
      sectionAlloc = {
        section: exam.section || targetSection,
        facultyName: exam.facultyName || 'CSE Faculty',
        group: exam.group || (['A1', 'A2', 'A3'].includes(targetSection) ? 'Group A' : 'Group B'),
        studentCount: exam.studentCount || 0,
        rosterSnapshot: exam.rosterSnapshot || [],
      };
    }

    // Role-based Permission Verification
    if (req.user && req.user.role === 'faculty') {
      const userFacultyName = (req.user.name || '').trim().toLowerCase();
      const allocFacultyName = (sectionAlloc.facultyName || '').trim().toLowerCase();

      // Check if user is the assigned faculty for this section
      const isAssigned =
        userFacultyName &&
        allocFacultyName &&
        (userFacultyName.includes(allocFacultyName) ||
          allocFacultyName.includes(userFacultyName) ||
          userFacultyName.split(' ').some((part) => part.length > 2 && allocFacultyName.includes(part)));

      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          message: `Access denied. You are only authorized to download attendance sheets for your assigned section (${sectionAlloc.facultyName || 'Other Faculty'} is assigned to Section ${targetSection}).`,
        });
      }
    }

    let students = sectionAlloc.rosterSnapshot || [];
    if (!students || students.length === 0) {
      // Query from Student collection
      const dbStudents = await Student.find({ examId: exam._id, section: targetSection }).sort({
        registrationNumber: 1,
      });
      if (dbStudents && dbStudents.length > 0) {
        students = dbStudents.map((s, idx) => ({
          sNo: idx + 1,
          registrationNumber: s.registrationNumber,
          name: s.name,
          questionPaperSet: s.questionPaperSet || (idx % 3 === 0 ? 'A' : idx % 3 === 1 ? 'B' : 'C'),
          group: s.group,
          section: s.section,
        }));
      }
    }

    // Authoritative section classroom assignment
    const classroomMappingService = require('../services/classroomMappingService');
    const designatedRoom =
      sectionAlloc.roomNumber ||
      classroomMappingService.getRoomNumberForSection(targetSection) ||
      '3020';

    let classroom = exam.classroomId;
    if (sectionAlloc.classroomId) {
      classroom = await Classroom.findById(sectionAlloc.classroomId);
    }
    if (!classroom || classroom.roomNumber !== designatedRoom) {
      classroom = await Classroom.findOne({ roomNumber: designatedRoom, isActive: true });
    }
    if (!classroom) {
      classroom = {
        name: sectionAlloc.classroomName || `ET BLOCK ${designatedRoom}`,
        roomNumber: designatedRoom,
      };
    }

    const pdfBuffer = await ReportService.generateFacultySectionAttendancePDF(
      exam,
      sectionAlloc,
      students,
      classroom
    );

    // Clean, standard filename: Attendance_A1.pdf, Attendance_A2.pdf, etc.
    const filename = `Attendance_${targetSection}.pdf`;

    sendBinaryReport(res, pdfBuffer, 'application/pdf', filename);
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// @desc    Download All Section Attendance Sheets as a ZIP Archive (Supports ?sections=A1,A2 filtering)
// @route   GET /api/reports/:id/attendance-zip
// @route   GET /api/exams/:id/reports/attendance-zip
// @access  Private (Admin / Exam Incharge)
exports.getCentralizedAttendanceZip = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid examination ID.' });
    }
    const exam = await Exam.findById(id).populate('classroomId').lean();
    if (!exam || exam.isDeleted) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    let allocations =
      exam.sectionAllocations && exam.sectionAllocations.length > 0
        ? exam.sectionAllocations
        : [
            {
              section: exam.section || 'A1',
              facultyName: exam.facultyName || 'CSE Faculty',
              group: exam.group || 'Group A',
              rosterSnapshot: exam.rosterSnapshot || [],
            },
          ];

    // Filter by selected sections if query parameter provided (e.g. ?sections=A1,A3)
    if (req.query.sections) {
      const selectedList = req.query.sections
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (selectedList.length > 0) {
        allocations = allocations.filter((a) => selectedList.includes(a.section));
      }
      if (allocations.length === 0) {
        return res.status(400).json({
          success: false,
          message: `None of the requested sections (${selectedList.join(', ')}) were found in this examination.`,
        });
      }
    }

    const sectionPdfs = [];
    const classroomMappingService = require('../services/classroomMappingService');

    for (const alloc of allocations) {
      try {
        let students = alloc.rosterSnapshot || [];
        if (!students || students.length === 0) {
          const dbStudents = await Student.find({ examId: exam._id, section: alloc.section }).sort({
            registrationNumber: 1,
          });
          if (dbStudents && dbStudents.length > 0) {
            students = dbStudents.map((s, idx) => ({
              sNo: idx + 1,
              registrationNumber: s.registrationNumber,
              name: s.name,
              questionPaperSet: s.questionPaperSet || (idx % 3 === 0 ? 'A' : idx % 3 === 1 ? 'B' : 'C'),
              group: s.group,
              section: s.section,
            }));
          }
        }

        const designatedRoom =
          alloc.roomNumber ||
          classroomMappingService.getRoomNumberForSection(alloc.section) ||
          '3020';

        let classroom = exam.classroomId;
        if (alloc.classroomId) {
          classroom = await Classroom.findById(alloc.classroomId);
        }
        if (!classroom || classroom.roomNumber !== designatedRoom) {
          classroom = await Classroom.findOne({ roomNumber: designatedRoom, isActive: true });
        }
        if (!classroom) {
          classroom = {
            name: alloc.classroomName || `ET BLOCK ${designatedRoom}`,
            roomNumber: designatedRoom,
          };
        }

        const pdfBuf = await ReportService.generateFacultySectionAttendancePDF(
          exam,
          alloc,
          students,
          classroom
        );

        // Explicit requested ZIP member filename: Attendance_A1.pdf, Attendance_A2.pdf, etc.
        const memberFilename = `Attendance_${alloc.section}.pdf`;
        sectionPdfs.push({ filename: memberFilename, buffer: pdfBuf });
      } catch (secErr) {
        return res.status(500).json({
          success: false,
          message: `Failed to generate attendance sheet for Section ${alloc.section}: ${secErr.message}`,
        });
      }
    }

    const zipBuffer = await ReportService.generateCentralizedZip(exam, sectionPdfs);
    const zipName = `Attendance_Sheets_${exam.subjectCode || 'Exam'}.zip`;

    sendBinaryReport(res, zipBuffer, 'application/zip', zipName);
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// @desc    7. Download Master Examination Allocation PDF
// @route   GET /api/exams/:id/reports/master-pdf
// @access  Private
exports.getMasterPDF = async (req, res) => {
  try {
    const { exam, allocation, classroom } = await getReportContext(req.params.id);
    const pdfBuffer = await ReportService.generateMasterPDF(exam, allocation, classroom);

    const filename = `Master_Allocation_${exam.subjectCode}_${exam.examDate.replace(/-/g, '')}.pdf`;

    sendBinaryReport(res, pdfBuffer, 'application/pdf', filename);
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// @desc    Download General Attendance Signature Sheet PDF (Supports ?section=A1 parameter)
// @route   GET /api/exams/:id/reports/signature-pdf
// @route   GET /api/reports/:id/signature-pdf
// @access  Private
exports.getSignaturePDF = async (req, res) => {
  try {
    const { id } = req.params;
    const requestedSection = req.query.section || req.query.sec;

    // 1. If explicit section query parameter is passed, route to section attendance PDF
    if (requestedSection) {
      req.params.section = requestedSection;
      return exports.getSectionAttendancePDF(req, res);
    }

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    // 2. If logged-in user is a faculty member accessing a parent exam without section param,
    // auto-detect their assigned section from sectionAllocations
    if (req.user && req.user.role === 'faculty' && exam.sectionAllocations && exam.sectionAllocations.length > 0) {
      const userFacultyName = (req.user.name || '').trim().toLowerCase();
      const matchedAlloc = exam.sectionAllocations.find((s) => {
        const facName = (s.facultyName || '').trim().toLowerCase();
        return (
          facName &&
          userFacultyName &&
          (userFacultyName.includes(facName) ||
            facName.includes(userFacultyName) ||
            userFacultyName.split(' ').some((p) => p.length > 2 && facName.includes(p)))
        );
      });

      if (matchedAlloc) {
        req.params.section = matchedAlloc.section;
        return exports.getSectionAttendancePDF(req, res);
      }
    }

    // 3. If parent examination with child sections, route to Section A1 attendance PDF
    // to strictly prevent multi-faculty text overlapping
    if (exam.sectionAllocations && exam.sectionAllocations.length > 0) {
      req.params.section = exam.sectionAllocations[0].section || 'A1';
      return exports.getSectionAttendancePDF(req, res);
    }

    // 4. Otherwise, generate signature sheet for single section exam
    const { allocation, classroom } = await getReportContext(id);
    const pdfBuffer = await ReportService.generateSignatureSheetPDF(exam, allocation, classroom);

    const filename = `Attendance_${exam.section || 'A1'}.pdf`;

    sendBinaryReport(res, pdfBuffer, 'application/pdf', filename);
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// @desc    Download Excel Allocation Spreadsheet
// @route   GET /api/exams/:id/reports/excel
// @access  Private
exports.getExcelReport = async (req, res) => {
  try {
    const { exam, allocation, classroom } = await getReportContext(req.params.id);
    const excelBuffer = await ExcelService.generateAllocationWorkbook(exam, allocation, classroom);

    const filename = `Allocation_Report_${exam.subjectCode}_${exam.examDate.replace(/-/g, '')}.xlsx`;

    sendBinaryReport(
      res,
      excelBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename
    );
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};
