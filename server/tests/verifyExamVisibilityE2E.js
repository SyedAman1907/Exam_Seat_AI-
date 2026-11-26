const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const FacultyMapping = require('../models/FacultyMapping');
const User = require('../models/User');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

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

function getFutureKolkataDate(daysAhead = 5) {
  const future = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(future);
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return {
    iso: `${map.year}-${map.month}-${map.day}`,
    dmy: `${map.day}/${map.month}/${map.year}`,
  };
}

function getTodayKolkataIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
}

async function run() {
  console.log('\n================================================================================');
  console.log('  EXAMSEAT AI — E2E EXAMINATION CREATION, PERSISTENCE & VISIBILITY AUDIT');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  const createdExamIds = [];
  const createdAllocationIds = [];

  function assert(cond, label, details = '') {
    if (cond) {
      console.log(`  PASS: ${label}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'examseat_ai' });

  // Remove any leftover E2E test artifacts from interrupted earlier runs only
  const staleTests = await Exam.find({
    examName: {
      $in: [
        'E2E Visibility Trace Draft Exam',
        'E2E Visibility Trace Pending Exam',
        'E2E Overdue Unreviewed Pending Safety Exam',
        'E2E Lifecycle Today Exam',
      ],
    },
  }).select('_id');
  if (staleTests.length > 0) {
    const staleIds = staleTests.map((e) => e._id);
    await Allocation.deleteMany({ examId: { $in: staleIds } });
    await Student.deleteMany({ examId: { $in: staleIds } });
    await Exam.deleteMany({ _id: { $in: staleIds } });
  }

  // Snapshot real data counts before running to ensure zero data loss
  const initialMappingCount = await FacultyMapping.countDocuments({ isCurrent: true });
  const initialMasterStudents = await Student.countDocuments({ examId: { $exists: false } });

  try {
    // 0. Authenticate Admin, Exam Incharge, and Faculty
    const adminLogin = await apiReq('POST', '/auth/login', {
      email: 'admin@rgmcet.edu.in',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
    });
    const adminToken = adminLogin.data?.token;
    assert(Boolean(adminToken), '0a. Admin Login & JWT Token');

    const inchargeLogin = await apiReq('POST', '/auth/login', {
      email: 'incharge@rgmcet.edu.in',
      password: process.env.INCHARGE_PASSWORD || 'InchargeExam@2026',
    });
    const inchargeToken = inchargeLogin.data?.token;
    assert(Boolean(inchargeToken), '0b. Exam Incharge Login & JWT Token');

    const subbaUser = await User.findOne({ email: 'subbalakshmi@rgmcet.edu.in' });
    assert(Boolean(subbaUser), '0c. Faculty User (Dr. S. Subbalakshmi) exists');
    const signFacultyToken = () =>
      jwt.sign({ id: subbaUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    let facultyToken = signFacultyToken();

    // Load Faculty's assigned mapping(s)
    const portalRes = await apiReq('GET', '/mappings/portal-groups', null, facultyToken);
    const subbaSubjects = portalRes.data?.subjects || [];
    const targetSubject = subbaSubjects[0];
    const targetSection = targetSubject?.sections?.[0];
    assert(
      portalRes.status === 200 && Boolean(targetSubject) && Boolean(targetSection),
      '0d. Faculty portal loaded assigned mapping',
      targetSubject ? `${targetSubject.subjectCode} - ${targetSection.section} (${targetSection.group})` : 'missing'
    );

    const futureDate = getFutureKolkataDate(6);
    const futureDateDmy = getFutureKolkataDate(7);
    const pastDate = getFutureKolkataDate(-1);
    const todayIso = getTodayKolkataIso();

    // =========================================================================
    // 1. CREATE DRAFT & PENDING_REVIEW EXAMS AS FACULTY AND VERIFY MONGODB _id
    // =========================================================================
    console.log('\n--- PART 1: Faculty Exam Creation -> MongoDB Verification -> Persistence ---');

    const resolvedGroup =
      targetSection.group ||
      (['A1', 'A2', 'A3'].includes(targetSection.section) ? 'Group A' : 'Group B');

    const draftPayload = {
      examName: 'E2E Visibility Trace Draft Exam',
      subjectName: targetSubject.subjectName,
      subjectCode: targetSubject.subjectCode,
      examDate: futureDate.iso,
      startTime: '09:30 AM',
      endTime: '11:30 AM',
      session: 'FN',
      group: resolvedGroup,
      academicYear: '2026-2027',
      year: targetSubject.year || 'III Year',
      semester: targetSubject.semester || 'I Semester',
      selectedMappingIds: [targetSection.mappingId],
      saveAsDraft: true,
    };

    const draftRes = await apiReq('POST', '/exams/create-centralized', draftPayload, facultyToken);
    const draftId = draftRes.data?.data?._id;
    if (draftId) createdExamIds.push(draftId);

    const dbDraft = draftId ? await Exam.findById(draftId).lean() : null;
    assert(
      draftRes.status === 201 &&
        draftRes.data?.success === true &&
        Boolean(draftId) &&
        Boolean(dbDraft) &&
        dbDraft.status === 'DRAFT' &&
        dbDraft.approvalStatus === 'DRAFT' &&
        dbDraft.academicYear === '2026-2027' &&
        dbDraft.subjectCode === targetSubject.subjectCode &&
        Array.isArray(dbDraft.sectionAllocations) &&
        dbDraft.sectionAllocations.length === 1 &&
        dbDraft.studentCount > 0,
      '1a. Faculty Draft creation returns real MongoDB _id and persists complete document',
      `id=${draftId}, students=${dbDraft?.studentCount}, err=${draftRes.data?.message || ''}`
    );

    const pendingPayload = {
      examName: 'E2E Visibility Trace Pending Exam',
      subjectName: targetSubject.subjectName,
      subjectCode: targetSubject.subjectCode,
      examDate: futureDateDmy.dmy, // Intentionally DD/MM/YYYY to verify Asia/Kolkata normalization
      startTime: '02:00 PM',
      endTime: '04:00 PM',
      session: 'AN',
      group: resolvedGroup,
      academicYear: '2026-2027',
      year: targetSubject.year || 'III Year',
      semester: targetSubject.semester || 'I Semester',
      selectedMappingIds: [targetSection.mappingId],
      saveAsDraft: false,
    };

    const pendingRes = await apiReq('POST', '/exams/create-centralized', pendingPayload, facultyToken);
    const pendingId = pendingRes.data?.data?._id;
    if (pendingId) createdExamIds.push(pendingId);

    const dbPending = pendingId ? await Exam.findById(pendingId).lean() : null;
    assert(
      pendingRes.status === 201 &&
        Boolean(pendingId) &&
        Boolean(dbPending) &&
        dbPending.status === 'SCHEDULED' &&
        dbPending.approvalStatus === 'PENDING_REVIEW' &&
        dbPending.examDate === futureDateDmy.iso,
      '1b. Faculty Pending Review creation normalizes DD/MM/YYYY date and persists in MongoDB',
      `id=${pendingId}, normalizedDate=${dbPending?.examDate}, msg=${pendingRes.data?.message || ''}`
    );

    // Confirm immediate visibility in Faculty Portal APIs
    const facListImmediate = await apiReq('GET', '/exams?scope=mine', null, facultyToken);
    const facIdsImmediate = (facListImmediate.data?.data || []).map((e) => e._id);
    assert(
      facListImmediate.status === 200 &&
        facIdsImmediate.includes(draftId) &&
        facIdsImmediate.includes(pendingId),
      '1c. Both newly created exams immediately appear in Faculty Portal GET /exams?scope=mine'
    );

    // Re-issue a brand new Faculty JWT (simulates browser refresh + logout/login)
    facultyToken = signFacultyToken();
    const facListAfterRelogin = await apiReq(
      'GET',
      '/exams?filter=all&academicYear=2026-2027',
      null,
      facultyToken
    );
    const facIdsRelogin = (facListAfterRelogin.data?.data || []).map((e) => e._id);
    assert(
      facListAfterRelogin.status === 200 &&
        facIdsRelogin.includes(draftId) &&
        facIdsRelogin.includes(pendingId),
      '1d. Both exams remain visible in Faculty Portal after refresh & re-login'
    );

    // =========================================================================
    // 2. ADMIN & EXAM INCHARGE VISIBILITY ACROSS ALL TABS / STATS / FILTERS
    // =========================================================================
    console.log('\n--- PART 2: Admin & Exam Incharge Visibility Across All Tabs & Stats ---');

    const [
      adminAllRes,
      adminDraftRes,
      adminPendingRes,
      adminUpcomingRes,
      adminStatsRes,
      inchargeAllRes,
      inchargePendingRes,
    ] = await Promise.all([
      apiReq('GET', '/exams?filter=all&academicYear=ALL&semester=ALL', null, adminToken),
      apiReq('GET', '/exams?filter=draft', null, adminToken),
      apiReq('GET', '/exams?filter=pending', null, adminToken),
      apiReq('GET', '/exams?filter=upcoming', null, adminToken),
      apiReq('GET', '/dashboard/stats', null, adminToken),
      apiReq('GET', '/exams?filter=all', null, inchargeToken),
      apiReq('GET', '/exams?filter=pending', null, inchargeToken),
    ]);

    const adminAllExams = adminAllRes.data?.data || [];
    const pendingInAll = adminAllExams.find((e) => e._id === pendingId);
    const draftInAll = adminAllExams.find((e) => e._id === draftId);

    assert(
      Boolean(pendingInAll) &&
        Boolean(draftInAll) &&
        Boolean(pendingInAll?.createdBy?.name) &&
        pendingInAll?.studentCount > 0 &&
        Array.isArray(pendingInAll?.sectionAllocations),
      '2a. Admin GET /exams?filter=all shows Draft + Pending exams with creator & section allocations',
      `creator=${pendingInAll?.createdBy?.name}, count=${pendingInAll?.studentCount}`
    );

    assert(
      (adminDraftRes.data?.data || []).some((e) => e._id === draftId),
      '2b. Admin GET /exams?filter=draft includes newly created Draft exam'
    );

    assert(
      (adminPendingRes.data?.data || []).some((e) => e._id === pendingId),
      '2c. Admin GET /exams?filter=pending includes newly created Pending Review exam'
    );

    assert(
      (adminUpcomingRes.data?.data || []).some((e) => e._id === pendingId),
      '2d. Admin GET /exams?filter=upcoming includes newly created future Pending exam'
    );

    const dashData = adminStatsRes.data?.data || {};
    const dashRecentIds = (dashData.recentExams || []).map((e) => e._id);
    assert(
      adminStatsRes.status === 200 &&
        Number(dashData.pendingApprovals) >= 1 &&
        dashRecentIds.includes(pendingId),
      '2e. Admin Dashboard stats (pendingApprovals & recentExams) reflects newly created Pending Review exam',
      `pendingApprovals=${dashData.pendingApprovals}`
    );

    assert(
      (inchargeAllRes.data?.data || []).some((e) => e._id === pendingId) &&
        (inchargePendingRes.data?.data || []).some((e) => e._id === pendingId),
      '2f. Exam Incharge Portal shows newly created Pending Review exam'
    );

    // Check academicYear filter isolation
    const yrMismatchRes = await apiReq(
      'GET',
      '/exams?filter=all&academicYear=2099-2100',
      null,
      adminToken
    );
    assert(
      yrMismatchRes.status === 200 && !(yrMismatchRes.data?.data || []).some((e) => e._id === pendingId),
      '2g. Academic Year filter excludes non-matching academic years cleanly'
    );

    // =========================================================================
    // 3. NON-DESTRUCTIVE PAST PENDING_REVIEW SAFETY (MIDNIGHT / SCHEDULER GUARD)
    // =========================================================================
    console.log('\n--- PART 3: Midnight / Overdue Guard for Unreviewed PENDING_REVIEW Exams ---');

    const overduePendingExam = await Exam.create({
      examName: 'E2E Overdue Unreviewed Pending Safety Exam',
      subjectName: targetSubject.subjectName,
      subjectCode: targetSubject.subjectCode,
      examDate: pastDate.iso,
      startTime: '01:10 AM',
      endTime: '02:30 AM',
      startDateTime: new Date(`${pastDate.iso}T01:10:00+05:30`),
      endDateTime: new Date(`${pastDate.iso}T02:30:00+05:30`),
      session: 'FN',
      group: 'Group B',
      academicYear: '2026-2027',
      year: targetSubject.year || 'III Year',
      semester: targetSubject.semester || 'I Semester',
      section: targetSection.section,
      facultyName: targetSection.facultyName,
      facultyId: subbaUser._id,
      createdBy: subbaUser._id,
      createdByRole: 'faculty',
      approvalStatus: 'PENDING_REVIEW',
      status: 'SCHEDULED',
      studentCount: 1,
      sectionAllocations: [
        {
          section: targetSection.section,
          facultyName: targetSection.facultyName,
          classroomName: 'ET BLOCK 3010',
          roomNumber: '3010',
          studentCount: 1,
          allocationStatus: 'GENERATED',
        },
      ],
    });
    createdExamIds.push(overduePendingExam._id.toString());

    // Trigger lazy autoCompleteExpiredExams via GET /exams?filter=pending
    const pendingAfterSweep = await apiReq('GET', '/exams?filter=pending', null, adminToken);
    const dbOverduePending = await Exam.findById(overduePendingExam._id).lean();
    assert(
      dbOverduePending.status !== 'COMPLETED' &&
        dbOverduePending.approvalStatus === 'PENDING_REVIEW' &&
        (pendingAfterSweep.data?.data || []).some(
          (e) => e._id === overduePendingExam._id.toString()
        ),
      '3. Unreviewed past-date PENDING_REVIEW exam is NEVER prematurely moved to COMPLETED'
    );

    // =========================================================================
    // 4. FULL LIFECYCLE: APPROVAL -> PUBLISHED -> ONGOING -> 10-MIN STUDENT WINDOW -> COMPLETED
    // =========================================================================
    console.log('\n--- PART 4: Full Lifecycle (Approve -> Published -> Ongoing -> Student Window -> Completed) ---');

    // Approve future exam & check APPROVED / SCHEDULED tabs
    const approveFutureRes = await apiReq('POST', `/exams/${pendingId}/publish`, {}, adminToken);
    const dbFutureApproved = await Exam.findById(pendingId).lean();
    assert(
      approveFutureRes.status === 200 &&
        dbFutureApproved.approvalStatus === 'APPROVED' &&
        ['SCHEDULED', 'PUBLISHED'].includes(dbFutureApproved.status),
      '4a. Admin approval/publish updates status from PENDING_REVIEW cleanly',
      `status=${dbFutureApproved.status}, approvalStatus=${dbFutureApproved.approvalStatus}`
    );

    // Active exam scheduled for TODAY to verify ONGOING, Student 10-min window, and COMPLETED
    const room3010 = await Classroom.findOne({ roomNumber: '3010' });
    const realStudent = await Student.findOne({
      section: targetSection.section,
      examId: { $exists: false },
    }).lean();
    const testRegNo = realStudent?.registrationNumber || '24091A0501';
    assert(Boolean(realStudent), '4b. Located real student in section for seating trace', testRegNo);

    const lifecycleDate = '2026-12-30';
    const startDt = new Date(`${lifecycleDate}T14:00:00+05:30`);
    const endDt = new Date(`${lifecycleDate}T16:00:00+05:30`);
    const lifecycleExam = await Exam.create({
      examName: 'E2E Lifecycle Today Exam',
      subjectName: targetSubject.subjectName,
      subjectCode: targetSubject.subjectCode,
      examDate: lifecycleDate,
      startTime: '02:00 PM',
      endTime: '04:00 PM',
      startDateTime: startDt,
      endDateTime: endDt,
      publicationTime: new Date(startDt.getTime() - 20 * 60 * 1000),
      session: 'AN',
      group: resolvedGroup,
      academicYear: '2026-2027',
      year: targetSubject.year || 'III Year',
      semester: targetSubject.semester || 'I Semester',
      section: targetSection.section,
      facultyName: targetSection.facultyName,
      facultyId: subbaUser._id,
      createdBy: subbaUser._id,
      createdByRole: 'faculty',
      approvalStatus: 'APPROVED',
      visibilityStatus: 'PUBLISHED',
      status: 'PUBLISHED',
      isParentExam: true,
      classroomId: room3010?._id,
      studentCount: 1,
      sectionAllocations: [
        {
          section: targetSection.section,
          group: resolvedGroup,
          facultyName: targetSection.facultyName,
          classroomId: room3010?._id,
          classroomName: 'ET BLOCK 3010',
          roomNumber: '3010',
          studentCount: 1,
          allocationStatus: 'GENERATED',
          rosterSnapshot: [
            {
              registrationNumber: testRegNo,
              name: realStudent?.name || 'Verified Student',
              group: resolvedGroup,
              section: targetSection.section,
              seatId: 'R1-B1-S1',
              questionPaperSet: 'A',
            },
          ],
        },
      ],
    });
    createdExamIds.push(lifecycleExam._id.toString());

    const testAlloc = await Allocation.create({
      examId: lifecycleExam._id,
      group: resolvedGroup,
      version: 1,
      status: 'PUBLISHED',
      isCurrent: true,
      randomSeed: 'e2e-lifecycle-test',
      students: [
        {
          registrationNumber: testRegNo,
          name: realStudent?.name || 'Verified Student',
          section: targetSection.section,
          group: resolvedGroup,
          seatId: 'R1-B1-S1',
          rowNumber: 1,
          benchNumber: 1,
          seatNumber: 1,
          questionPaperSet: 'A',
          roomNumber: '3010',
          classroomName: 'ET BLOCK 3010',
          classroomId: room3010?._id,
          facultyName: targetSection.facultyName,
        },
      ],
    });
    lifecycleExam.currentAllocationId = testAlloc._id;
    await lifecycleExam.save();
    createdAllocationIds.push(testAlloc._id.toString());

    // Check Today tab + Ongoing transition during active window (14:05 IST, inside 14:00-16:00)
    const ongoingRes = await apiReq('GET', '/exams?filter=ongoing', null, adminToken, {
      'x-test-timestamp': `${lifecycleDate}T14:05:00+05:30`,
    });
    const dbExamOngoing = await Exam.findById(lifecycleExam._id).lean();
    assert(
      dbExamOngoing.status === 'ONGOING' &&
        (ongoingRes.data?.data || []).some((e) => e._id === lifecycleExam._id.toString()),
      '4c. During [start, end), active exam transitions to ONGOING and appears in ongoing filter',
      `status=${dbExamOngoing.status}`
    );

    // Check Student 20-min early access window via POST /api/student/lookup (14:00-16:00 exam => opens 13:40 IST):
    // 13:39 hidden (PENDING), 13:40 visible, 14:05 visible, 16:00 hidden (CLOSED)
    const checkStudentAt = (timeStr) =>
      apiReq(
        'POST',
        '/student/lookup',
        { registrationNumber: testRegNo, examId: lifecycleExam._id, date: lifecycleDate },
        null,
        { 'x-test-timestamp': `${lifecycleDate}T${timeStr}+05:30` }
      );

    const studentBefore = await checkStudentAt('13:39:00');
    const studentAtUnlock = await checkStudentAt('13:40:00');
    const studentInside = await checkStudentAt('14:05:00');
    const studentAfter = await checkStudentAt('16:00:00');
    assert(
      studentBefore.status === 403 &&
        studentBefore.data?.isPending === true &&
        studentAtUnlock.status === 200 &&
        studentAtUnlock.data?.data?.roomNumber === '3010' &&
        studentInside.status === 200 &&
        studentInside.data?.data?.roomNumber === '3010' &&
        studentAfter.status === 403 &&
        studentAfter.data?.isWindowClosed === true,
      '4d. Student portal opens 20 mins before start until exam end (hidden @13:39, visible @13:40 & @14:05, hidden @16:00)'
    );

    // Check Completion at endDateTime (16:00 IST) -> COMPLETED & preserved
    const completedRes = await apiReq('GET', '/exams?filter=completed', null, adminToken, {
      'x-test-timestamp': `${lifecycleDate}T16:00:00+05:30`,
    });
    const upcomingAtEndRes = await apiReq('GET', '/exams?filter=upcoming', null, adminToken, {
      'x-test-timestamp': `${lifecycleDate}T16:00:00+05:30`,
    });
    const dbExamCompleted = await Exam.findById(lifecycleExam._id).lean();
    assert(
      dbExamCompleted.status === 'COMPLETED' &&
        dbExamCompleted.sectionAllocations?.[0]?.allocationStatus === 'COMPLETED' &&
        (completedRes.data?.data || []).some((e) => e._id === lifecycleExam._id.toString()) &&
        !(upcomingAtEndRes.data?.data || []).some((e) => e._id === lifecycleExam._id.toString()),
      '4e. At scheduled end time, exam transitions to COMPLETED, moves to Completed tab, and preserves DB records'
    );

    // Verify Faculty can delete their OWN DRAFT exam safely (soft-archive + cleanup allocations + excluded from queries)
    const facDelDraftRes = await apiReq('DELETE', `/exams/${draftId}`, null, facultyToken);
    const dbDeletedDraft = await Exam.findById(draftId).lean();
    const afterDelList = await apiReq('GET', '/exams?filter=all', null, facultyToken);
    assert(
      facDelDraftRes.status === 200 &&
        dbDeletedDraft?.isDeleted === true &&
        dbDeletedDraft?.isActive === false &&
        !(afterDelList.data?.data || []).some((e) => e._id === draftId),
      '4f. Faculty can delete own DRAFT exam cleanly (soft-archived & excluded from exam lists)'
    );
  } finally {
    // Cleanup ONLY test documents created during this script
    if (createdAllocationIds.length > 0) {
      await Allocation.deleteMany({ _id: { $in: createdAllocationIds } });
    }
    if (createdExamIds.length > 0) {
      await Student.deleteMany({ examId: { $in: createdExamIds } });
      await Allocation.deleteMany({ examId: { $in: createdExamIds } });
      await Exam.deleteMany({ _id: { $in: createdExamIds } });
    }

    const finalMappingCount = await FacultyMapping.countDocuments({ isCurrent: true });
    const finalMasterStudents = await Student.countDocuments({ examId: { $exists: false } });
    assert(
      finalMappingCount === initialMappingCount && finalMasterStudents === initialMasterStudents,
      '5. Zero genuine academic mappings or master student records deleted',
      `mappings=${finalMappingCount}, students=${finalMasterStudents}`
    );

    await mongoose.disconnect();
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error running test:', err);
  process.exit(1);
});
