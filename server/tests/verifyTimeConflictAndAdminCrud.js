const mongoose = require('mongoose');
const path = require('path');
const pdfParse = require('pdf-parse');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const FacultyMapping = require('../models/FacultyMapping');
const { connectDB } = require('../config/db');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';
const TEST_TAG = 'VERIFY_TIME_CONFLICT_CRUD_2028';

async function apiReq(method, endpoint, body = null, token = null, headers = {}) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function fetchBuffer(endpoint, token) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers };
}

async function run() {
  console.log('\n================================================================================');
  console.log('  EXAMSEAT AI — TIME (AM/PM), OVERNIGHT, CONFLICT & ADMIN CRUD VERIFICATION (12)');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  const createdExamIds = [];

  function assert(cond, label, details = '') {
    if (cond) {
      console.log(`  PASS: ${label}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  await connectDB();

  const initialMasterStudentCount = await Student.countDocuments({ examId: { $exists: false } });
  const initialMappingCount = await FacultyMapping.countDocuments({ isCurrent: true });
  const initialClassroomCount = await Classroom.countDocuments({ isActive: true });

  // Clean up any stale test exams from an interrupted run
  const stale = await Exam.find({ examName: new RegExp(TEST_TAG, 'i') }).select('_id').lean();
  if (stale.length > 0) {
    const staleIds = stale.map((s) => s._id);
    await Student.deleteMany({ examId: { $in: staleIds } });
    await Allocation.deleteMany({ examId: { $in: staleIds } });
    await Exam.deleteMany({ _id: { $in: staleIds } });
  }

  try {
    // 0. Authenticate Admin
    const adminLogin = await apiReq('POST', '/auth/login', {
      email: 'admin@rgmcet.edu.in',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
    });
    const adminToken = adminLogin.data?.token;
    assert(Boolean(adminToken), '0. Admin login succeeds and issues JWT');

    // Resolve permanent mappings for ATCD (Automata Theory and Compiler Design)
    const resolveGroupA = await apiReq(
      'GET',
      '/exams/resolve-mappings?subjectName=Automata+Theory+and+Compiler+Design&group=Group+A&academicYear=2026-2027&year=III+Year&semester=I+Semester',
      null,
      adminToken
    );
    const resolveGroupB = await apiReq(
      'GET',
      '/exams/resolve-mappings?subjectName=Automata+Theory+and+Compiler+Design&group=Group+B&academicYear=2026-2027&year=III+Year&semester=I+Semester',
      null,
      adminToken
    );
    const mapA = resolveGroupA.data?.mappings || [];
    const mapB = resolveGroupB.data?.mappings || [];
    assert(mapA.length > 0 && mapB.length > 0, '0b. Resolved real permanent Group A & Group B mappings', `A=${mapA.length}, B=${mapB.length}`);

    const commonMeta = {
      academicYear: '2026-2027',
      year: 'III Year',
      semester: 'I Semester',
      subjectName: 'Automata Theory and Compiler Design',
      subjectCode: '20A05501T',
    };

    // -------------------------------------------------------------------------
    // SCENARIO 1: 01:45 AM – 02:45 AM creation & canonical storage
    // -------------------------------------------------------------------------
    console.log('\n--- 1. 01:45 AM - 02:45 AM Creation & Canonical Storage ---');
    const exam1Res = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Early Morning AM`,
        examDate: '2028-04-10',
        startTime: '01:45 AM',
        endTime: '02:45 AM',
        session: 'FN',
        group: 'Group A',
      },
      adminToken
    );
    const exam1 = exam1Res.data?.data;
    if (exam1?._id) createdExamIds.push(exam1._id);
    assert(
      exam1Res.status === 201 &&
        exam1?.startTime === '01:45 AM' &&
        exam1?.endTime === '02:45 AM' &&
        exam1?.formattedTimeRange === '01:45 AM \u2013 02:45 AM',
      '1. Creates 01:45 AM - 02:45 AM cleanly without mixing AM/PM',
      `saved=${exam1?.startTime} - ${exam1?.endTime}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 2: 01:45 PM – 02:45 PM same date/group/rooms (NO false collision with AM!)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. 01:45 PM - 02:45 PM (Same Date/Rooms as 01:45 AM) ---');
    const avail2Res = await apiReq(
      'POST',
      '/exams/check-availability',
      {
        examDate: '2028-04-10',
        startTime: '01:45 PM',
        endTime: '02:45 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    assert(
      avail2Res.status === 200 && avail2Res.data?.available === true,
      '2a. Live check-availability reports NO conflict between 01:45 AM and 01:45 PM',
      `conflicts=${(avail2Res.data?.conflicts || []).length}`
    );

    const exam2Res = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Afternoon PM`,
        examDate: '2028-04-10',
        startTime: '01:45 PM',
        endTime: '02:45 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    const exam2 = exam2Res.data?.data;
    if (exam2?._id) createdExamIds.push(exam2._id);
    assert(
      exam2Res.status === 201 &&
        exam2?.startTime === '01:45 PM' &&
        exam2?.endTime === '02:45 PM',
      '2b. Creates 01:45 PM - 02:45 PM cleanly on same day/rooms without AM collision',
      `saved=${exam2?.startTime} - ${exam2?.endTime}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 3: 11:30 AM – 12:30 PM crossing noon + rejecting invalid PM->PM reversed time
    // -------------------------------------------------------------------------
    console.log('\n--- 3. 11:30 AM - 12:30 PM & Reversed Time Validation ---');
    const invalidReversedRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Invalid Reversed`,
        examDate: '2028-04-11',
        startTime: '02:45 PM',
        endTime: '01:45 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    assert(
      invalidReversedRes.status === 400,
      '3a. Rejects reversed same-meridiem range 02:45 PM - 01:45 PM with HTTP 400',
      invalidReversedRes.data?.message || ''
    );

    const exam3Res = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Cross Noon`,
        examDate: '2028-04-11',
        startTime: '11:30 AM',
        endTime: '12:30 PM',
        session: 'FN',
        group: 'Group A',
      },
      adminToken
    );
    const exam3 = exam3Res.data?.data;
    if (exam3?._id) createdExamIds.push(exam3._id);
    assert(
      exam3Res.status === 201 &&
        exam3?.startTime === '11:30 AM' &&
        exam3?.endTime === '12:30 PM' &&
        new Date(exam3.endDateTime).getTime() - new Date(exam3.startDateTime).getTime() === 60 * 60 * 1000,
      '3b. Creates 11:30 AM - 12:30 PM crossing noon with exact 60 min duration'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 4: Explicit Overnight (11:30 PM - 12:30 AM) & AN Morning Guard
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Explicit Overnight (11:30 PM - 12:30 AM), AN/FN Guard & Cross-Midnight Overlap ---');
    const implicitOvernightReject = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Implicit Overnight Rejected`,
        examDate: '2028-04-11',
        startTime: '11:30 PM',
        endTime: '12:30 AM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    const anMorningReject = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} AN Morning Rejected`,
        examDate: '2028-04-11',
        startTime: '09:00 AM',
        endTime: '12:02 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    assert(
      implicitOvernightReject.status === 400 && anMorningReject.status === 400,
      '4a-pre. Rejects implicit PM->AM overnight without allowOvernight AND rejects AN starting at 09:00 AM'
    );

    const exam4Res = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Overnight Exam`,
        examDate: '2028-04-11',
        startTime: '11:30 PM',
        endTime: '12:30 AM',
        session: 'AN',
        allowOvernight: true,
        group: 'Group A',
      },
      adminToken
    );
    const exam4 = exam4Res.data?.data;
    if (exam4?._id) createdExamIds.push(exam4._id);
    const overnightDurationMs =
      new Date(exam4?.endDateTime || 0).getTime() - new Date(exam4?.startDateTime || 0).getTime();
    assert(
      exam4Res.status === 201 &&
        exam4?.startTime === '11:30 PM' &&
        exam4?.endTime === '12:30 AM' &&
        exam4?.startTime24 === '23:30' &&
        exam4?.endTime24 === '00:30' &&
        overnightDurationMs === 60 * 60 * 1000,
      '4a. Creates explicit allowOvernight 11:30 PM - 12:30 AM exam with 24h & next-day IST timestamp'
    );

    // Check next-day 12:15 AM - 01:15 AM MUST conflict with 11:30 PM - 12:30 AM from 2028-04-11!
    const overnightOverlapRes = await apiReq(
      'POST',
      '/exams/check-availability',
      {
        examDate: '2028-04-12',
        startTime: '12:15 AM',
        endTime: '01:15 AM',
        session: 'FN',
        group: 'Group A',
      },
      adminToken
    );
    assert(
      overnightOverlapRes.status === 200 &&
        overnightOverlapRes.data?.available === false &&
        (overnightOverlapRes.data?.conflicts || []).some((c) =>
          (c.existingExamTitle || c.existingExamName || '').includes('Overnight Exam')
        ),
      '4b. Detects cross-midnight conflict on 2028-04-12 12:15 AM against 2028-04-11 11:30 PM - 12:30 AM'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 5 & 6: Non-overlapping 02:10 PM -> 02:30 PM allowed vs genuine overlap rejected 409
    // -------------------------------------------------------------------------
    console.log('\n--- 5 & 6. Boundary Slots (02:10 PM vs 02:30 PM) & Overlap Conflict (409) ---');
    const exam5aRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Slot Till 02:10 PM`,
        examDate: '2028-04-12',
        startTime: '01:10 PM',
        endTime: '02:10 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    const exam5a = exam5aRes.data?.data;
    if (exam5a?._id) createdExamIds.push(exam5a._id);
    assert(exam5aRes.status === 201, '5a. Creates baseline 01:10 PM - 02:10 PM on 2028-04-12');

    const exam5bRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Slot From 02:30 PM`,
        examDate: '2028-04-12',
        startTime: '02:30 PM',
        endTime: '03:30 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    const exam5b = exam5bRes.data?.data;
    if (exam5b?._id) createdExamIds.push(exam5b._id);
    assert(
      exam5bRes.status === 201,
      '5b. Allows non-overlapping 02:30 PM - 03:30 PM after 02:10 PM in the SAME classrooms'
    );

    // Genuine overlap: 01:45 PM - 02:45 PM overlaps BOTH 01:10-02:10 PM and 02:30-03:30 PM!
    const overlap6Res = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Overlapping Reject Test`,
        examDate: '2028-04-12',
        startTime: '01:45 PM',
        endTime: '02:45 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    const hasConflictDetails = (d) =>
      Boolean(d && (Array.isArray(d) ? d.length > 0 : d.existingExamId || d.existingExamTitle));

    assert(
      overlap6Res.status === 409 &&
        hasConflictDetails(overlap6Res.data?.conflictDetails) &&
        overlap6Res.data.message.includes('01:10 PM') &&
        overlap6Res.data.message.includes('02:10 PM'),
      '6. Rejects genuine overlap with HTTP 409 & exact canonical AM/PM conflictDetails',
      overlap6Res.data?.message || ''
    );

    // -------------------------------------------------------------------------
    // SCENARIO 7 & 8: Admin Edit without Self-Conflict vs Conflict with Another Exam
    // -------------------------------------------------------------------------
    console.log('\n--- 7 & 8. Admin Edit Examination (Self-Exclude & Conflict Rejection) ---');
    const editSelfRes = await apiReq(
      'PUT',
      `/exams/${exam5a._id}`,
      {
        examName: `${TEST_TAG} Slot Till 02:10 PM Edited`,
        examDate: '2028-04-12',
        startTime: '01:00 PM',
        endTime: '02:15 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    assert(
      editSelfRes.status === 200 &&
        editSelfRes.data?.data?.startTime === '01:00 PM' &&
        editSelfRes.data?.data?.endTime === '02:15 PM',
      '7. Admin Edit shifts time (01:00 PM - 02:15 PM) cleanly without false self-conflict'
    );

    // Try editing exam5a into exam5b's 02:30 PM - 03:30 PM window -> must reject 409!
    const editConflictRes = await apiReq(
      'PUT',
      `/exams/${exam5a._id}`,
      {
        examDate: '2028-04-12',
        startTime: '02:20 PM',
        endTime: '03:10 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    assert(
      editConflictRes.status === 409 &&
        hasConflictDetails(editConflictRes.data?.conflictDetails),
      '8. Rejects Admin Edit into another exam time window with HTTP 409',
      editConflictRes.data?.message || ''
    );

    // -------------------------------------------------------------------------
    // SCENARIO 9: Admin Deletes Pending Exam & Immediately Releases Classroom
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Admin Delete Pending Exam & Release Classroom ---');
    const delRes = await apiReq('DELETE', `/exams/${exam5b._id}`, null, adminToken);
    assert(delRes.status === 200 && delRes.data?.success === true, '9a. Admin deletes pending examination successfully');

    const reuseAfterDeleteRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Reused After Delete`,
        examDate: '2028-04-12',
        startTime: '02:30 PM',
        endTime: '03:30 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    const reusedExam = reuseAfterDeleteRes.data?.data;
    if (reusedExam?._id) createdExamIds.push(reusedExam._id);
    assert(
      reuseAfterDeleteRes.status === 201,
      '9b. Released classrooms allow creating a new exam in the deleted exam slot'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 10: Admin Controlled Edit on Published Exam & Cancel Preserving History
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Published Controlled Admin Edit & Cancel Preserving History ---');
    const pubRes = await apiReq('POST', `/exams/${reusedExam._id}/publish`, {}, adminToken);
    assert(pubRes.status === 200, '10a. Admin approves/publishes exam cleanly');

    // Simulate active T-20 publication transition to verify PUBLISHED controlled correction workflow
    await Exam.updateOne(
      { _id: reusedExam._id },
      { $set: { status: 'PUBLISHED', visibilityStatus: 'PUBLISHED' } }
    );

    // Attempt normal edit on published exam WITHOUT controlled correction flag -> must 400!
    const unconfirmedPubEdit = await apiReq(
      'PUT',
      `/exams/${reusedExam._id}`,
      { startTime: '02:45 PM', endTime: '03:45 PM', session: 'AN' },
      adminToken
    );
    assert(
      unconfirmedPubEdit.status === 400,
      '10b. Published exam blocks unconfirmed edit with HTTP 400 requiring Controlled Correction'
    );

    // Apply Controlled Admin Edit WITH confirmation & reason -> preserves existing Allocation ID!
    const beforePubAllocId = reusedExam.currentAllocationId;
    const controlledEditRes = await apiReq(
      'PUT',
      `/exams/${reusedExam._id}`,
      {
        examDate: '2028-04-12',
        startTime: '02:45 PM',
        endTime: '03:45 PM',
        session: 'AN',
        confirmControlledCorrection: true,
        correctionReason: 'Official shift by 15 minutes per Principal circular',
      },
      adminToken
    );
    assert(
      controlledEditRes.status === 200 &&
        controlledEditRes.data?.data?.startTime === '02:45 PM' &&
        controlledEditRes.data?.data?.endTime === '03:45 PM' &&
        String(controlledEditRes.data?.data?.currentAllocationId) === String(beforePubAllocId),
      '10c. Controlled Admin Edit updates time cleanly while preserving existing student Allocation'
    );

    // Cancel published examination -> sets CANCELLED, preserves Allocation, and frees room!
    const cancelRes = await apiReq(
      'POST',
      `/exams/${reusedExam._id}/cancel`,
      { reason: 'Postponed due to university holiday announcement' },
      adminToken
    );
    const preservedAlloc = await Allocation.findOne({ examId: reusedExam._id });
    assert(
      cancelRes.status === 200 &&
        cancelRes.data?.data?.status === 'CANCELLED' &&
        Boolean(preservedAlloc),
      '10d. Cancelling published exam sets CANCELLED and retains historical Allocation in MongoDB'
    );

    const postCancelReuseRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Slot After Cancel`,
        examDate: '2028-04-12',
        startTime: '02:45 PM',
        endTime: '03:45 PM',
        session: 'AN',
        group: 'Group A',
      },
      adminToken
    );
    if (postCancelReuseRes.data?.data?._id) createdExamIds.push(postCancelReuseRes.data.data._id);
    assert(
      postCancelReuseRes.status === 201,
      '10e. Cancelling published exam frees classrooms for immediate re-booking'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 11: Independent Group A & Group B + Selective Sections
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Independent Group A / Group B & Per-Section Selection ---');
    // Schedule Group A (only A1, A2 selected -> leaving A3 room 3030 FREE)
    const grpASelectiveRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Group A Partial A1-A2`,
        examDate: '2028-04-13',
        startTime: '09:30 AM',
        endTime: '11:30 AM',
        session: 'FN',
        group: 'Group A',
        selectedSections: ['A1', 'A2'],
      },
      adminToken
    );
    const grpAExam = grpASelectiveRes.data?.data;
    if (grpAExam?._id) createdExamIds.push(grpAExam._id);

    // Concurrently schedule Group B (A4-A6) at the SAME exact time 09:30 AM - 11:30 AM!
    const grpBConcurrentRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Group B Concurrent`,
        examDate: '2028-04-13',
        startTime: '09:30 AM',
        endTime: '11:30 AM',
        session: 'FN',
        group: 'Group B',
      },
      adminToken
    );
    const grpBExam = grpBConcurrentRes.data?.data;
    if (grpBExam?._id) createdExamIds.push(grpBExam._id);

    // Also schedule remaining deselected section A3 independently in its free room 3030 at the SAME time!
    const grpA3OnlyRes = await apiReq(
      'POST',
      '/exams/create-centralized',
      {
        ...commonMeta,
        examName: `${TEST_TAG} Independent A3 Only`,
        examDate: '2028-04-13',
        startTime: '09:30 AM',
        endTime: '11:30 AM',
        session: 'FN',
        group: 'Group A',
        selectedSections: ['A3'],
      },
      adminToken
    );
    if (grpA3OnlyRes.data?.data?._id) createdExamIds.push(grpA3OnlyRes.data.data._id);

    assert(
      grpASelectiveRes.status === 201 &&
        grpAExam?.sectionAllocations?.length === 2 &&
        grpBConcurrentRes.status === 201 &&
        grpA3OnlyRes.status === 201,
      '11. Group A (A1-A2), Group B (A4-A6), and leftover Section A3 book same 09:30 AM - 11:30 AM slot without cross-collision'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 12: AM/PM Time Consistency across PDFs, Excel, Student Portal & Faculty/Admin Lists
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Consistent AM/PM Time across PDFs, Excel, Student & Faculty Portals ---');
    // Publish exam2 (01:45 PM - 02:45 PM on 2028-04-10) so we can verify reports & student lookup
    await apiReq('POST', `/exams/${exam2._id}/publish`, {}, adminToken);

    // 12a. Attendance PDF for Section A1
    const attPdf = await fetchBuffer(`/reports/${exam2._id}/section-attendance-pdf/A1`, adminToken);
    const attText = attPdf.status === 200 ? (await pdfParse(attPdf.buf)).text : '';
    assert(
      attPdf.status === 200 &&
        attText.includes('01:45 PM') &&
        attText.includes('02:45 PM') &&
        !attText.includes('01:45 AM'),
      '12a. Attendance PDF renders exact 01:45 PM - 02:45 PM without mixing AM/PM'
    );

    // 12b. Master Seating Chart PDF
    const seatPdf = await fetchBuffer(`/reports/${exam2._id}/seating-pdf`, adminToken);
    const seatText = seatPdf.status === 200 ? (await pdfParse(seatPdf.buf)).text : '';
    assert(
      seatPdf.status === 200 &&
        seatText.includes('01:45 PM') &&
        seatText.includes('02:45 PM') &&
        !seatText.includes('01:45 AM'),
      '12b. Master Seating Chart PDF renders exact 01:45 PM - 02:45 PM'
    );

    // 12c. Excel Allocation Workbook
    const xlsRes = await fetchBuffer(`/reports/${exam2._id}/excel`, adminToken);
    let xlsJoined = '';
    if (xlsRes.status === 200) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsRes.buf);
      wb.eachSheet((ws) => {
        ws.eachRow((row) => {
          xlsJoined += ` ${row.values.join(' ')}`;
        });
      });
    }
    assert(
      xlsRes.status === 200 &&
        xlsJoined.includes('01:45 PM') &&
        xlsJoined.includes('02:45 PM') &&
        !xlsJoined.includes('01:45 AM'),
      '12c. Excel report workbook renders exact 01:45 PM - 02:45 PM'
    );

    // 12d. Student Seat Finder inside visibility window (1:47 PM IST on 2028-04-10)
    const alloc2 = await Allocation.findOne({ examId: exam2._id }).lean();
    const stuReg = alloc2?.students?.[0]?.registrationNumber;
    const stuLookup = await apiReq(
      'POST',
      '/student/lookup',
      { registrationNumber: stuReg, examId: exam2._id, date: '2028-04-10' },
      null,
      { 'x-test-timestamp': '2028-04-10T13:47:00+05:30' }
    );
    assert(
      stuLookup.status === 200 &&
        Boolean(stuLookup.data?.data?.seatId) &&
        stuLookup.data?.data?.startTime === '01:45 PM' &&
        stuLookup.data?.data?.endTime === '02:45 PM' &&
        stuLookup.data?.data?.examinationTime?.includes('01:45 PM') &&
        stuLookup.data?.data?.examinationTime?.includes('02:45 PM'),
      '12d. Student Seat Finder renders exact 01:45 PM - 02:45 PM inside live visibility window'
    );

    // 12e. Admin / Staff Exam List formattedTimeRange & permissions
    const listRes = await apiReq('GET', '/exams?filter=all', null, adminToken);
    const listedExam2 = (listRes.data?.data || []).find((e) => String(e._id) === String(exam2._id));
    assert(
      listedExam2 &&
        listedExam2.startTime === '01:45 PM' &&
        listedExam2.endTime === '02:45 PM' &&
        listedExam2.formattedTimeRange === '01:45 PM \u2013 02:45 PM' &&
        listedExam2.permissions?.canEdit === true,
      '12e. Exam list API returns canonical formattedTimeRange and Admin permissions'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 13: Subject Sync (MOOC's 20A05508M) & Dynamic Cohort Totals
    // -------------------------------------------------------------------------
    console.log("\n--- 13. Subject Synchronization (MOOC's 20A05508M -> 6 Sections / 432 Students) ---");
    const subSyncRes = await apiReq('GET', '/subjects', null, adminToken);
    const moocsInSubjects = (subSyncRes.data?.data || []).some(
      (s) => String(s.subjectCode).toUpperCase() === '20A05508M'
    );
    const moocsAllRes = await apiReq(
      'GET',
      '/exams/resolve-mappings?subjectCode=20A05508M&academicYear=2026-2027&year=III+Year&semester=I+Semester&group=ALL',
      null,
      adminToken
    );
    const moocsGrpARes = await apiReq(
      'GET',
      '/exams/resolve-mappings?subjectCode=20A05508M&academicYear=2026-2027&year=III+Year&semester=I+Semester&group=Group+A',
      null,
      adminToken
    );
    assert(
      subSyncRes.status === 200 &&
        moocsInSubjects &&
        moocsAllRes.data?.mappings?.length === 6 &&
        moocsAllRes.data?.summary?.totalEnrollments === 432 &&
        moocsGrpARes.data?.mappings?.length === 3 &&
        moocsGrpARes.data?.summary?.totalEnrollments === 216,
      "13. MOOC's (20A05508M) syncs cleanly across /subjects & /resolve-mappings (ALL=6/432, GroupA=3/216)"
    );
  } finally {
    // Cleanup ONLY test exams & allocations created during this script
    if (createdExamIds.length > 0) {
      await Student.deleteMany({ examId: { $in: createdExamIds } });
      await Allocation.deleteMany({ examId: { $in: createdExamIds } });
      await Exam.deleteMany({ _id: { $in: createdExamIds } });
    }
    const postMasterStudents = await Student.countDocuments({ examId: { $exists: false } });
    const postMappings = await FacultyMapping.countDocuments({ isCurrent: true });
    const postClassrooms = await Classroom.countDocuments({ isActive: true });

    assert(
      postMasterStudents === initialMasterStudentCount &&
        postMappings === initialMappingCount &&
        postClassrooms === initialClassroomCount,
      'Integrity Check: Zero genuine master students, mappings, or classrooms altered',
      `students=${postMasterStudents}, mappings=${postMappings}, classrooms=${postClassrooms}`
    );

    await mongoose.disconnect();
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Fatal test failure:', err);
  try {
    await mongoose.disconnect();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
