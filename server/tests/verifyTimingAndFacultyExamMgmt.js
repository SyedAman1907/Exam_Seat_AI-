const mongoose = require('mongoose');
const path = require('path');
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

async function run() {
  console.log('\n================================================================================');
  console.log('  EXAMSEAT AI — VISIBILITY TIMING (12:45 PM) & FACULTY EXAM MANAGEMENT AUDIT');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, label, details = '') {
    if (cond) {
      console.log(`  ✓ PASS: ${label}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${label}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'examseat_ai' });

  // Clean up any leftover test artifacts from previous runs
  await Exam.deleteMany({
    examName: {
      $in: [
        'Visibility 12:45 PM Verification Exam',
        'Faculty Draft Management Test Exam',
        'Faculty Updated Management Test Exam',
        'Faculty Published Guard Test Exam',
      ],
    },
  });

  // 1. Admin & Exam Incharge tokens
  const adminLogin = await apiReq('POST', '/auth/login', {
    email: 'admin@rgmcet.edu.in',
    password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
  });
  const adminToken = adminLogin.data?.token;
  assert(Boolean(adminToken), '0a. Admin Login & Token Acquisition');

  const inchargeLogin = await apiReq('POST', '/auth/login', {
    email: 'incharge@rgmcet.edu.in',
    password: process.env.INCHARGE_PASSWORD || 'InchargeExam@2026',
  });
  const inchargeToken = inchargeLogin.data?.token;
  assert(Boolean(inchargeToken), '0b. Exam Incharge Login & Token Acquisition');

  // Ensure test password is known for Dr. S. Subbalakshmi & Dr. K. Subba Rao via temporary test faculty helper or existing users
  const subbaUser = await User.findOne({ email: 'subbalakshmi@rgmcet.edu.in' });
  const subbaRaoUser = await User.findOne({ email: 'subbarao@rgmcet.edu.in' });

  // Create isolated temporary test tokens via JWT directly ONLY if password unknown, or login if matches;
  // Using auth/login with temporary faculty or verifying existing faculty accounts cleanly:
  const jwt = require('jsonwebtoken');
  const signToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2h' });

  const facultySubbalakshmiToken = signToken(subbaUser._id);
  const facultyOtherToken = signToken(subbaRaoUser._id);

  // Verify mapping counts before tests (to prove zero deletion of genuine data)
  const initialMappingCount = await FacultyMapping.countDocuments({ isCurrent: true });
  const initialMasterStudentCount = await Student.countDocuments({ examId: { $exists: false } });

  // =========================================================================
  // PART 1: EXACT STUDENT SEATING VISIBILITY TIMING (25 NOV 2026, 12:45 PM)
  // =========================================================================
  console.log('--- PART 1: Student Seating Visibility Window (12:45 PM – 12:55 PM IST) ---');

  const testExamDate = '2026-12-28';
  const startDateTime = new Date(`${testExamDate}T12:45:00+05:30`);
  const endDateTime = new Date(`${testExamDate}T15:45:00+05:30`);
  const room3010 = await Classroom.findOne({ roomNumber: '3010' });
  const sampleStudent = await Student.findOne({ registrationNumber: { $exists: true } });
  const testRegNo = sampleStudent ? sampleStudent.registrationNumber : '24091A0501';

  const visExam = await Exam.create({
    examName: 'Visibility 12:45 PM Verification Exam',
    academicYear: '2026-2027',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    section: 'A1',
    group: 'Group A',
    subjectName: 'Automata Theory and Compiler Design',
    subjectCode: '20A05501T',
    examDate: testExamDate,
    startTime: '12:45 PM',
    endTime: '03:45 PM',
    session: 'AN',
    startDateTime,
    endDateTime,
    publicationTime: new Date(startDateTime.getTime() - 20 * 60 * 1000),
    approvalStatus: 'APPROVED',
    visibilityStatus: 'PUBLISHED',
    status: 'PUBLISHED',
    isParentExam: true,
    classroomId: room3010?._id,
    facultyName: 'Dr. S. Subbalakshmi',
    studentCount: 1,
    sectionAllocations: [
      {
        section: 'A1',
        group: 'Group A',
        facultyName: 'Dr. S. Subbalakshmi',
        classroomId: room3010?._id,
        classroomName: 'ET BLOCK 3010',
        roomNumber: '3010',
        allocationStatus: 'GENERATED',
        studentCount: 1,
        rosterSnapshot: [
          {
            registrationNumber: testRegNo,
            name: sampleStudent?.name || 'Test Candidate',
            group: 'Group A',
            section: 'A1',
            seatId: 'R1-B1-S1',
            questionPaperSet: 'A',
          },
        ],
      },
    ],
  });

  const visAlloc = await Allocation.create({
    examId: visExam._id,
    group: 'Group A',
    version: 1,
    status: 'PUBLISHED',
    isCurrent: true,
    randomSeed: 'vis-1245-test',
    students: [
      {
        registrationNumber: testRegNo,
        name: sampleStudent?.name || 'Test Candidate',
        section: 'A1',
        group: 'Group A',
        seatId: 'R1-B1-S1',
        rowNumber: 1,
        benchNumber: 1,
        seatNumber: 1,
        questionPaperSet: 'A',
        roomNumber: '3010',
        classroomName: 'ET BLOCK 3010',
        classroomId: room3010?._id,
        facultyName: 'Dr. S. Subbalakshmi',
      },
    ],
  });
  visExam.currentAllocationId = visAlloc._id;
  await visExam.save();

  const checkLookupAt = async (isoTime) =>
    apiReq(
      'POST',
      '/student/lookup',
      { registrationNumber: testRegNo, examId: visExam._id, date: testExamDate },
      null,
      { 'x-test-timestamp': `${testExamDate}T${isoTime}+05:30` }
    );

  // 1. At 12:15 PM -> hidden, says available at 12:25 PM (20 mins before 12:45 PM), NOT closed
  const r1215 = await checkLookupAt('12:15:00');
  assert(
    r1215.status === 403 &&
      r1215.data.isPending === true &&
      !r1215.data.isWindowClosed &&
      r1215.data.message.includes('12:25 PM') &&
      !r1215.data.data,
    '1. At 12:15 PM: Seating HIDDEN with "available at 12:25 PM" notice (never "Window Closed")',
    `HTTP ${r1215.status}: ${r1215.data.message}`
  );

  // Also check /student/active-exams at 12:15 PM
  const active1215 = await apiReq(
    'GET',
    `/student/active-exams?date=${testExamDate}`,
    null,
    null,
    { 'x-test-timestamp': `${testExamDate}T12:15:00+05:30` }
  );
  const foundVis1215 = (active1215.data?.data || []).find(
    (e) => e._id.toString() === visExam._id.toString()
  );
  assert(
    foundVis1215?.windowState === 'PENDING',
    '1b. /student/active-exams at 12:15 PM reports windowState=PENDING',
    `State: ${foundVis1215?.windowState}`
  );

  // 2. At 12:24 PM -> hidden (1 min before T-20)
  const r1224 = await checkLookupAt('12:24:00');
  assert(
    r1224.status === 403 && r1224.data.isPending === true && !r1224.data.data,
    '2. At 12:24 PM: Seating remains HIDDEN',
    `HTTP ${r1224.status}`
  );

  // 3. At 12:25 PM -> visible (exact T-20 unlock)
  const r1225 = await checkLookupAt('12:25:00');
  assert(
    r1225.status === 200 && r1225.data.data?.roomNumber === '3010' && r1225.data.data?.questionPaperSet === 'A',
    '3. At 12:25 PM: Seating becomes VISIBLE (20 min before 12:45 PM start)',
    `Room ${r1225.data.data?.roomNumber}, Seat ${r1225.data.data?.seatId}`
  );

  // 4. At 12:30 PM (during 20-min early access) -> student CAN view seat AND exam is NOT COMPLETED yet
  const r1230 = await checkLookupAt('12:30:00');
  const dbExamAt1230 = await Exam.findById(visExam._id);
  assert(
    r1230.status === 200 && Boolean(r1230.data.data?.seatId) && ['PUBLISHED', 'ONGOING'].includes(dbExamAt1230.status),
    '4. At 12:30 PM: Student early access allowed AND exam remains active/PUBLISHED (NOT prematurely COMPLETED)',
    `Status=${dbExamAt1230.status}`
  );

  // 5. At 12:45 PM -> visible (actual start time)
  const r1245 = await checkLookupAt('12:45:00');
  assert(
    r1245.status === 200 && r1245.data.data?.roomNumber === '3010',
    '5. At 12:45 PM: Seating remains VISIBLE'
  );

  // 6. At 03:44 PM -> visible (1 min before 03:45 PM end)
  const r1544 = await checkLookupAt('15:44:00');
  assert(
    r1544.status === 200 && r1544.data.data?.roomNumber === '3010',
    '6. At 03:44 PM: Seating remains VISIBLE until exam end'
  );

  // 7. At 03:45 PM -> hidden (exam end time)
  const r1545 = await checkLookupAt('15:45:00');
  assert(
    r1545.status === 403 && r1545.data.isWindowClosed === true && !r1545.data.data,
    '7. At 03:45 PM: Seating becomes HIDDEN ("Access Window Closed")',
    `HTTP ${r1545.status}`
  );

  // 8. At 3:45 PM (exam end time) -> becomes COMPLETED
  const resEnd = await apiReq('GET', '/exams?filter=completed', null, adminToken, {
    'x-test-timestamp': `${testExamDate}T15:45:00+05:30`,
  });
  const dbExamAtEnd = await Exam.findById(visExam._id);
  const inCompletedTab = (resEnd.data?.data || []).some(
    (e) => e._id.toString() === visExam._id.toString()
  );
  assert(
    dbExamAtEnd.status === 'COMPLETED' && inCompletedTab,
    '8. At 3:45 PM (scheduled end time): Examination transitions to COMPLETED and appears in Completed tab'
  );

  // Clean up visibility test exam
  await Exam.findByIdAndDelete(visExam._id);
  await Allocation.findByIdAndDelete(visAlloc._id);

  // =========================================================================
  // PART 2: FACULTY PORTAL EXAMINATION MANAGEMENT & STRICT PERMISSIONS
  // =========================================================================
  console.log('\n--- PART 2: Faculty Exam Create / View / Edit / Delete & RBAC ---');

  // 9. Faculty sees ONLY their own assigned mappings
  const subbaPortal = await apiReq('GET', '/mappings/portal-groups', null, facultySubbalakshmiToken);
  const subbaSubjects = subbaPortal.data?.subjects || [];
  const allOwnedBySubba = subbaSubjects.every((s) =>
    s.sections.every((sec) => sec.facultyName.toLowerCase().includes('subbalakshmi'))
  );
  assert(
    subbaPortal.status === 200 && subbaSubjects.length > 0 && allOwnedBySubba,
    '9. Faculty Portal isolates mappings strictly to logged-in faculty (Dr. S. Subbalakshmi)',
    `${subbaPortal.data?.stats?.totalSections} assigned section(s)`
  );

  // Unassigned faculty cannot access Dr. S. Subbalakshmi's mapping
  const firstSubbaMappingId = subbaSubjects[0]?.sections[0]?.mappingId;
  const unauthRosterRes = await apiReq(
    'GET',
    `/mappings/${firstSubbaMappingId}`,
    null,
    facultyOtherToken
  );
  assert(
    unauthRosterRes.status === 403,
    '9b. Faculty cannot inspect another faculty member’s mapping roster (403 Forbidden)'
  );

  // 10. Faculty cannot create exam using another faculty member's mappingId
  const crossFacCreate = await apiReq(
    'POST',
    '/exams/create-centralized',
    {
      examName: 'Unauthorized Cross Faculty Exam',
      subjectName: subbaSubjects[0].subjectName,
      subjectCode: subbaSubjects[0].subjectCode,
      examDate: '2026-12-10',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      group: 'Group A',
      selectedMappingIds: [firstSubbaMappingId],
      saveAsDraft: true,
    },
    facultyOtherToken
  );
  assert(
    crossFacCreate.status === 403,
    '10. Cross-faculty exam creation blocked with HTTP 403 Forbidden'
  );

  // 11. Faculty creates Draft Examination across own assigned section (A1)
  const targetSub = subbaSubjects.find((s) =>
    s.sections.some((sec) => sec.section === 'A1')
  ) || subbaSubjects[0];
  const a1Section = targetSub.sections.find((sec) => sec.section === 'A1') || targetSub.sections[0];

  const createDraftRes = await apiReq(
    'POST',
    '/exams/create-centralized',
    {
      examName: 'Faculty Draft Management Test Exam',
      academicYear: '2026-2027',
      year: targetSub.year || 'III Year',
      semester: targetSub.semester || 'I Semester',
      subjectName: targetSub.subjectName,
      subjectCode: targetSub.subjectCode,
      examDate: '2026-12-15',
      startTime: '10:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      group: 'Group A',
      selectedSections: [a1Section.section],
      selectedMappingIds: [a1Section.mappingId],
      saveAsDraft: true,
    },
    facultySubbalakshmiToken
  );
  const createdExamId = createDraftRes.data?.data?._id;
  assert(
    createDraftRes.status === 201 &&
      Boolean(createdExamId) &&
      createDraftRes.data?.data?.approvalStatus === 'DRAFT' &&
      createDraftRes.data?.data?.status === 'DRAFT',
    '11. Faculty creates Draft examination for assigned section',
    `Exam ID: ${createdExamId}`
  );

  // Verify persistence via GET /api/exams and GET /api/exams/:id
  const detailRes = await apiReq('GET', `/exams/${createdExamId}`, null, facultySubbalakshmiToken);
  assert(
    detailRes.status === 200 &&
      detailRes.data?.data?.examName === 'Faculty Draft Management Test Exam' &&
      detailRes.data?.data?.canEdit === true &&
      detailRes.data?.data?.canDelete === true,
    '11b. Created examination persists in MongoDB and returns View/Edit/Delete permissions'
  );

  // 12. Another faculty cannot view/edit/delete this exam
  const otherEditRes = await apiReq(
    'PUT',
    `/exams/${createdExamId}`,
    { examName: 'Hijacked Title' },
    facultyOtherToken
  );
  const otherDeleteRes = await apiReq('DELETE', `/exams/${createdExamId}`, null, facultyOtherToken);
  assert(
    otherEditRes.status === 403 && otherDeleteRes.status === 403,
    '12. Another faculty member is blocked (403) from editing or deleting this examination'
  );

  // 13. Faculty edits their Draft examination (changes title, date, time, and submits for review)
  const editRes = await apiReq(
    'PUT',
    `/exams/${createdExamId}`,
    {
      examName: 'Faculty Updated Management Test Exam',
      examDate: '2026-12-16',
      startTime: '02:00 PM',
      endTime: '04:00 PM',
      session: 'AN',
      group: 'Group A',
      selectedSections: [a1Section.section],
      selectedMappingIds: [a1Section.mappingId],
      submitForReview: true,
    },
    facultySubbalakshmiToken
  );
  const afterEditDb = await Exam.findById(createdExamId);
  const allocVersions = await Allocation.find({ examId: createdExamId }).sort({ version: 1 });
  assert(
    editRes.status === 200 &&
      afterEditDb.examName === 'Faculty Updated Management Test Exam' &&
      afterEditDb.examDate === '2026-12-16' &&
      afterEditDb.startTime === '02:00 PM' &&
      afterEditDb.approvalStatus === 'PENDING_REVIEW' &&
      allocVersions.length === 2 &&
      allocVersions[0].isCurrent === false &&
      allocVersions[1].isCurrent === true,
    '13. Faculty edit updates MongoDB schedule, transitions to PENDING_REVIEW, and safely regenerates draft allocation (V1 superseded, V2 current)',
    `Allocations count: ${allocVersions.length}`
  );

  // 14. Admin approves & publishes -> Faculty cannot directly delete published exam, can submit cancel request
  const adminPublishRes = await apiReq('POST', `/exams/${createdExamId}/publish`, {}, adminToken);
  const facDeletePublished = await apiReq(
    'DELETE',
    `/exams/${createdExamId}`,
    null,
    facultySubbalakshmiToken
  );
  const facReqCancel = await apiReq(
    'POST',
    `/exams/${createdExamId}/request-cancel`,
    { reason: 'Department schedule adjustment required.' },
    facultySubbalakshmiToken
  );
  assert(
    adminPublishRes.status === 200 &&
      (facDeletePublished.status === 400 || facDeletePublished.status === 403) &&
      facReqCancel.status === 200 &&
      facReqCancel.data?.data?.cancellationRequested === true,
    '14. Published/Approved exam cannot be deleted by faculty; cancellation request to Admin succeeds'
  );

  // Admin cleans up that test published exam via cancel + hard remove test record
  await Exam.findByIdAndDelete(createdExamId);
  await Allocation.deleteMany({ examId: createdExamId });
  await Student.deleteMany({ examId: createdExamId });

  // 15. Faculty creates & deletes an eligible DRAFT examination -> clean deletion & mapping preservation
  const draft2Res = await apiReq(
    'POST',
    '/exams/create-centralized',
    {
      examName: 'Faculty Draft Management Test Exam',
      subjectName: targetSub.subjectName,
      subjectCode: targetSub.subjectCode,
      examDate: '2026-12-18',
      startTime: '09:00 AM',
      endTime: '11:00 AM',
      session: 'FN',
      group: 'Group A',
      selectedSections: [a1Section.section],
      selectedMappingIds: [a1Section.mappingId],
      saveAsDraft: true,
    },
    facultySubbalakshmiToken
  );
  const draft2Id = draft2Res.data?.data?._id;
  const delDraftRes = await apiReq('DELETE', `/exams/${draft2Id}`, null, facultySubbalakshmiToken);
  const draft2AllocsRemaining = await Allocation.countDocuments({ examId: draft2Id });
  const afterMappingCount = await FacultyMapping.countDocuments({ isCurrent: true });
  const afterMasterStudentCount = await Student.countDocuments({ examId: { $exists: false } });

  assert(
    delDraftRes.status === 200 &&
      draft2AllocsRemaining === 0 &&
      afterMappingCount === initialMappingCount &&
      afterMasterStudentCount === initialMasterStudentCount,
    '15. Faculty deletes eligible DRAFT exam: draft allocations removed, permanent mappings & master students preserved',
    `Mappings: ${afterMappingCount}, MasterStudents: ${afterMasterStudentCount}`
  );
  await Exam.findByIdAndDelete(draft2Id);

  // 16. Admin views all examinations & Exam Incharge centralized resolve still works
  const adminAllExams = await apiReq('GET', '/exams', null, adminToken);
  const inchargeResolve = await apiReq(
    'GET',
    '/exams/resolve-mappings?subjectCode=20A05501T&group=Group%20A',
    null,
    inchargeToken
  );
  assert(
    adminAllExams.status === 200 &&
      inchargeResolve.status === 200 &&
      inchargeResolve.data?.mappings?.length > 0,
    '16. Admin full view and Exam Incharge centralized mapping resolution remain operational',
    `Incharge resolved ${inchargeResolve.data?.mappings?.length} Group A sections`
  );

  console.log('\n================================================================================');
  console.log(`  AUDIT SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================================\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error running test:', err);
  process.exit(1);
});
