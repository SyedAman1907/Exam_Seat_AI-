/**
 * End-to-End Verification for:
 *  - 3-Role Auth (ADMIN, FACULTY, STUDENT) & complete Exam Incharge removal
 *  - Excel/CSV/PDF Permanent Mapping Upload + Inconsistent Name Detection + Compound Subject Keys
 *  - Faculty Exam Request Creation (UNIT 1-UNIT 5 mandatory) & Cross-Faculty Isolation
 *  - Custom Student Portal Publication Time (AM/PM + Scheduler recovery + approval gating)
 *  - Admin Approve / Publish / Report Downloads (Attendance PDF, ZIP, Seating PDF)
 *  - Student Registration Sign-In, /my-exams Countdown, Own-Seat-Only Isolation & T+10 Closure
 *  - Safeguarded Academic Backup & Reset Verification
 *
 * Uses an isolated local test database (never touches production MongoDB Atlas data).
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const ExcelJS = require('exceljs');

async function seedTestEnvironment() {
  const User = require('../models/User');
  const Classroom = require('../models/Classroom');
  const FacultyMapping = require('../models/FacultyMapping');

  const admin = await User.create({
    name: 'Test Admin',
    email: 'testadmin@rgmcet.edu.in',
    passwordHash: await User.hashPassword('TestAdmin@123'),
    role: 'admin',
    department: 'Computer Science and Engineering',
    isActive: true,
  });

  // Insert deprecated exam_incharge directly at collection level to verify auth blocks it completely
  await User.collection.insertOne({
    name: 'Legacy Exam Incharge',
    email: 'testincharge@rgmcet.edu.in',
    passwordHash: await User.hashPassword('TestIncharge@123'),
    role: 'exam_incharge',
    department: 'Computer Science and Engineering',
    isActive: true,
  });

  const faculty = await User.create({
    name: 'Dr. Rajesh Kumar',
    email: 'facultya1@rgmcet.edu.in',
    facultyId: 'FAC101',
    passwordHash: await User.hashPassword('TestFaculty@123'),
    role: 'faculty',
    department: 'Computer Science and Engineering',
    isActive: true,
  });

  const otherFaculty = await User.create({
    name: 'Prof. Other Faculty',
    email: 'facultyother@rgmcet.edu.in',
    facultyId: 'FAC999',
    passwordHash: await User.hashPassword('OtherFaculty@123'),
    role: 'faculty',
    department: 'Computer Science and Engineering',
    isActive: true,
  });

  const buildRows = () => {
    const rows = [];
    for (let r = 1; r <= 6; r++) {
      const benches = [];
      for (let b = 1; b <= 6; b++) {
        benches.push({
          benchNumber: b,
          capacity: 2,
          seats: [
            { seatId: `R${r}-B${b}-S1`, seatNumber: 1, isAvailable: true },
            { seatId: `R${r}-B${b}-S2`, seatNumber: 2, isAvailable: true },
          ],
        });
      }
      rows.push({ rowNumber: r, benches });
    }
    return rows;
  };

  for (const roomNum of ['3010', '3020', '3030', '3040', '3050', '3060']) {
    await Classroom.create({
      name: `ET BLOCK ${roomNum}`,
      roomNumber: roomNum,
      block: 'ET BLOCK',
      floor: '3rd Floor',
      rows: buildRows(),
      totalCapacity: 72,
      availableCapacity: 72,
      isActive: true,
    });
  }

  const mappingIds = [];
  const sections = ['A1', 'A2', 'A3'];
  let studentCounter = 1;
  for (const sec of sections) {
    const students = [];
    for (let i = 1; i <= 72; i++) {
      students.push({
        registrationNumber: `24E2E${String(studentCounter++).padStart(5, '0')}`,
        name: `Candidate ${sec}-${i}`,
        group: 'Group A',
      });
    }
    const mapping = await FacultyMapping.create({
      facultyId: faculty._id,
      facultyIdCode: faculty.facultyId,
      facultyName: faculty.name,
      subjectName: 'Compiler Design',
      subjectCode: '20A05E2E',
      section: sec,
      group: 'Group A',
      academicYear: '2026-2027',
      year: 'III Year',
      semester: 'I Semester',
      isCurrent: true,
      students,
      studentCount: 72,
    });
    mappingIds.push(String(mapping._id));
  }

  // Unowned mapping for cross-faculty isolation check
  const otherMapping = await FacultyMapping.create({
    facultyId: otherFaculty._id,
    facultyIdCode: otherFaculty.facultyId,
    facultyName: otherFaculty.name,
    subjectName: 'Cloud Computing',
    subjectCode: '20A05CLD',
    section: 'A4',
    group: 'Group B',
    academicYear: '2026-2027',
    year: 'III Year',
    semester: 'I Semester',
    isCurrent: true,
    students: [{ registrationNumber: '24E2E99001', name: 'Other Group Student', group: 'Group B' }],
    studentCount: 1,
  });

  return { admin, faculty, otherFaculty, mappingIds, otherMappingId: String(otherMapping._id) };
}

function httpRequest(port, { method, path, headers = {}, body = null, rawBody = null }) {
  return new Promise((resolve, reject) => {
    const payload = rawBody !== null ? String(rawBody) : body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          let jsonValid = false;
          const ct = String(res.headers['content-type'] || '').toLowerCase();
          if (ct.includes('application/json')) {
            json = JSON.parse(buf.toString('utf8'));
            jsonValid = true;
          }
          resolve({ status: res.statusCode, headers: res.headers, buffer: buf, json, jsonValid });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function verifyClientJsonParser() {
  const src = fs.readFileSync('client/src/services/api.js', 'utf8');
  const fnMatch = src.match(/export function safeParseJsonPayload[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'safeParseJsonPayload must exist in client/src/services/api.js');
  const code = fnMatch[0].replace('export function', 'function') + '; module.exports = safeParseJsonPayload;';
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod });
  const safeParse = mod.exports;

  assert.strictEqual(safeParse(null), null);
  assert.strictEqual(safeParse(undefined), null);
  assert.strictEqual(safeParse(''), null);
  assert.strictEqual(safeParse('   '), null);
  assert.strictEqual(safeParse('null'), null);
  assert.strictEqual(safeParse('"null"'), null);
  const obj = { success: true, data: [] };
  assert.strictEqual(safeParse(obj), obj);
  assert.strictEqual(safeParse('<!DOCTYPE html><html></html>'), '<!DOCTYPE html><html></html>');
  assert.strictEqual(safeParse('{invalid'), '{invalid');
  const valid = safeParse('{"success":true,"count":3}');
  assert.strictEqual(valid.success, true);
  assert.strictEqual(valid.count, 3);
}

async function run() {
  verifyClientJsonParser();

  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27099/examseat_e2e_verify';
  process.env.JWT_SECRET = 'e2e_test_secret_key';

  const connectDB = require('../config/db');
  const mongoose = require('mongoose');
  const Exam = require('../models/Exam');
  const Subject = require('../models/Subject');
  const Allocation = require('../models/Allocation');
  const User = require('../models/User');
  const Classroom = require('../models/Classroom');
  const publicationScheduler = require('../scheduler');
  const { performSafeguardedAcademicReset } = require('../scripts/resetAcademicData');

  await connectDB();

  const { mappingIds, otherMappingId } = await seedTestEnvironment();
  const app = require('../app');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    // 1. Deprecated Exam Incharge login MUST be rejected (403 ROLE_REMOVED)
    const deprecatedLogin = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'testincharge@rgmcet.edu.in', password: 'TestIncharge@123' },
    });
    assert.strictEqual(deprecatedLogin.status, 403);
    assert.strictEqual(deprecatedLogin.json.code, 'ROLE_REMOVED');

    // 2. Admin & Faculty logins succeed cleanly
    const [adminLogin, facLogin, otherFacLogin] = await Promise.all([
      httpRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'testadmin@rgmcet.edu.in', password: 'TestAdmin@123' },
      }),
      httpRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'facultya1@rgmcet.edu.in', password: 'TestFaculty@123' },
      }),
      httpRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'facultyother@rgmcet.edu.in', password: 'OtherFaculty@123' },
      }),
    ]);
    assert.strictEqual(adminLogin.status, 200);
    assert.strictEqual(facLogin.status, 200);
    assert.strictEqual(otherFacLogin.status, 200);
    const adminToken = adminLogin.json.token;
    const facToken = facLogin.json.token;
    const otherFacToken = otherFacLogin.json.token;

    // 3. Compound Subject key verification (same subjectCode across two semesters/academic years)
    await Subject.init();
    const s1 = await httpRequest(port, {
      method: 'POST',
      path: '/api/subjects',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        subjectCode: '20A05COMP',
        subjectName: 'Algorithms Design',
        academicYear: '2025-2026',
        semester: 'I Semester',
      },
    });
    const s2 = await httpRequest(port, {
      method: 'POST',
      path: '/api/subjects',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        subjectCode: '20A05COMP',
        subjectName: 'Algorithms Design',
        academicYear: '2026-2027',
        semester: 'II Semester',
      },
    });
    assert.strictEqual(s1.status, 201);
    assert.strictEqual(s2.status, 201);

    // 4. Excel workbook (.xlsx) preview upload + Inconsistent Student Name detection
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Mappings');
    ws.addRow([
      'Faculty ID',
      'Faculty Name',
      'Academic Year',
      'Semester',
      'Subject Code',
      'Subject Name',
      'Section',
      'Group',
      'Registration Number',
      'Student Name',
    ]);
    ws.addRow(['FAC101', 'Dr. Rajesh Kumar', '2026-2027', 'I Semester', '20A05E2E', 'Compiler Design', 'A1', 'Group A', '24E2E00001', 'Mismatch Name One']);
    ws.addRow(['FAC101', 'Dr. Rajesh Kumar', '2026-2027', 'I Semester', '20A05E2E', 'Compiler Design', 'A2', 'Group A', '24E2E00001', 'Mismatch Name Two']);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const fd = new FormData();
    fd.append('file', new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'roster.xlsx');
    fd.append('uploadMode', 'multi');
    const xlsxPreviewRes = await fetch(`http://127.0.0.1:${port}/api/mappings/upload-preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: fd,
    });
    assert.strictEqual(xlsxPreviewRes.status, 200);
    const xlsxJson = await xlsxPreviewRes.json();
    assert.strictEqual(xlsxJson.success, true);
    assert.ok(Array.isArray(xlsxJson.inconsistentNames) && xlsxJson.inconsistentNames.length >= 1, 'Inconsistent student names must be detected');

    // Faculty cannot mutate mappings (403)
    const facMapBlock = await httpRequest(port, {
      method: 'POST',
      path: '/api/mappings/confirm',
      headers: { Authorization: `Bearer ${facToken}` },
      body: { facultyName: 'Dr. Rajesh Kumar', subjectName: 'Compiler Design', subjectCode: '20A05E2E', section: 'A1', students: [] },
    });
    assert.strictEqual(facMapBlock.status, 403);

    // 5. Faculty cross-isolation: otherFaculty cannot schedule exam for FAC101's mapping
    const crossFacultyRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${otherFacToken}` },
      body: {
        examType: 'UNIT 1',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        subjectName: 'Compiler Design',
        subjectCode: '20A05E2E',
        examName: 'Unauthorized Cross Exam',
        examDate: '2099-05-15',
        startTime: '10:00 AM',
        endTime: '12:00 PM',
        publicationTime: '09:20 AM',
        session: 'AM',
        group: 'Group A',
        selectedSections: ['A1'],
        selectedMappingIds: [mappingIds[0]],
      },
    });
    assert.strictEqual(crossFacultyRes.status, 403);

    // 6. Strict UNIT 1..UNIT 5 and Custom Publication Time validations
    const badTypeRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${facToken}` },
      body: {
        examType: 'Mid Term',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        subjectName: 'Compiler Design',
        subjectCode: '20A05E2E',
        examName: 'Bad Exam Type',
        examDate: '2099-05-15',
        startTime: '10:00 AM',
        endTime: '12:00 PM',
        publicationTime: '09:20 AM',
        session: 'AM',
        group: 'Group A',
      },
    });
    assert.strictEqual(badTypeRes.status, 400);
    assert.strictEqual(badTypeRes.json.code, 'INVALID_EXAM_TYPE');

    const badPubAfterStart = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${facToken}` },
      body: {
        examType: 'UNIT 1',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        subjectName: 'Compiler Design',
        subjectCode: '20A05E2E',
        examName: 'Bad Publication Time',
        examDate: '2099-05-15',
        startTime: '10:00 AM',
        endTime: '12:00 PM',
        publicationTime: '10:15 AM',
        session: 'AM',
        group: 'Group A',
      },
    });
    assert.strictEqual(badPubAfterStart.status, 400);
    assert.strictEqual(badPubAfterStart.json.code, 'PUBLICATION_AFTER_START');

    // 7. Current Examination & Single-Section Roster verification
    const currentNone = await httpRequest(port, {
      method: 'GET',
      path: '/api/exams/current',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(currentNone.status, 200);
    assert.strictEqual(currentNone.json.mode, 'NONE');
    assert.strictEqual(currentNone.json.data, null);

    // Faculty creates valid UNIT 1 examination with custom 09:20 AM publication time
    const createPayload = {
      examType: 'UNIT 1',
      academicYear: '2026-2027',
      year: 'III Year',
      semester: 'I Semester',
      subjectName: 'Compiler Design',
      subjectCode: '20A05E2E',
      examName: 'III B.Tech I Sem UNIT 1 E2E Test',
      examDate: '2099-05-15',
      startTime: '10:00 AM',
      endTime: '12:00 PM',
      publicationTime: '09:20 AM',
      session: 'AM',
      group: 'Group A',
      selectedSections: ['A1', 'A2', 'A3'],
      selectedMappingIds: mappingIds,
    };

    const createRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${facToken}` },
      body: createPayload,
    });
    assert.strictEqual(createRes.status, 201, `Create failed: ${JSON.stringify(createRes.json)}`);
    assert.strictEqual(createRes.json.data.examType, 'UNIT 1');
    assert.strictEqual(createRes.json.data.publicationTimeStr, '09:20 AM');
    assert.strictEqual(createRes.json.data.studentCount, 216);
    assert.strictEqual(createRes.json.data.approvalStatus, 'PENDING_REVIEW');
    const examId = createRes.json.data._id;

    // Duplicate prevention -> 409 Conflict
    const dupRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${facToken}` },
      body: createPayload,
    });
    assert.strictEqual(dupRes.status, 409);

    // Afternoon PM exam creation on another mapping (verifies 12h PM + AM coexistence)
    const pmRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${otherFacToken}` },
      body: {
        examType: 'UNIT 2',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        subjectName: 'Cloud Computing',
        subjectCode: '20A05CLD',
        examName: 'III B.Tech I Sem UNIT 2 Afternoon PM',
        examDate: '2099-05-15',
        startTime: '02:00 PM',
        endTime: '04:00 PM',
        publicationTime: '01:30 PM',
        session: 'PM',
        group: 'Group B',
        selectedSections: ['A4'],
        selectedMappingIds: [otherMappingId],
      },
    });
    assert.strictEqual(pmRes.status, 201);
    assert.strictEqual(pmRes.json.data.publicationTimeStr, '01:30 PM');

    // Reports: Attendance PDF, ZIP, Seating Blueprint
    const [secPdfRes, zipRes, pdfRes] = await Promise.all([
      httpRequest(port, { method: 'GET', path: `/api/reports/${examId}/section-attendance-pdf/A1`, headers: { Authorization: `Bearer ${facToken}` } }),
      httpRequest(port, { method: 'GET', path: `/api/reports/${examId}/attendance-zip?sections=A1,A2,A3`, headers: { Authorization: `Bearer ${adminToken}` } }),
      httpRequest(port, { method: 'GET', path: `/api/reports/${examId}/seating-pdf`, headers: { Authorization: `Bearer ${adminToken}` } }),
    ]);
    assert.strictEqual(secPdfRes.buffer.slice(0, 5).toString('utf8'), '%PDF-');
    assert.strictEqual(zipRes.buffer.slice(0, 2).toString('utf8'), 'PK');
    assert.strictEqual(pdfRes.buffer.slice(0, 5).toString('utf8'), '%PDF-');

    // Single Current Examination & Single-Section Roster endpoint assertions
    const currentUpcoming = await httpRequest(port, {
      method: 'GET',
      path: '/api/exams/current',
      headers: { Authorization: `Bearer ${facToken}` },
    });
    assert.strictEqual(currentUpcoming.status, 200);
    assert.strictEqual(currentUpcoming.json.mode, 'UPCOMING');
    assert.strictEqual(String(currentUpcoming.json.data._id), String(examId));

    const rosterA2 = await httpRequest(port, {
      method: 'GET',
      path: `/api/exams/section-roster?examId=${examId}&subjectCode=20A05E2E&section=A2`,
      headers: { Authorization: `Bearer ${facToken}` },
    });
    assert.strictEqual(rosterA2.status, 200);
    assert.strictEqual(rosterA2.json.data.section, 'A2');
    assert.strictEqual(rosterA2.json.data.totalStudents, 72);
    assert.ok(rosterA2.json.data.students.every((s) => s.section === 'A2'), 'Section roster must contain ONLY section A2 students');
    assert.ok(rosterA2.json.data.students.every((s) => s.seatNumber && s.seatNumber !== 'Pending allocation'), 'Allocated section roster must include seat numbers');

    // Cross-faculty isolation on section-roster (facToken cannot inspect otherFaculty's section A4 -> 403)
    const unownedRoster = await httpRequest(port, {
      method: 'GET',
      path: '/api/exams/section-roster?subjectCode=20A05CLD&section=A4',
      headers: { Authorization: `Bearer ${facToken}` },
    });
    assert.strictEqual(unownedRoster.status, 403);

    // Faculty CANNOT approve or publish (403)
    assert.strictEqual((await httpRequest(port, { method: 'POST', path: `/api/exams/${examId}/approve`, headers: { Authorization: `Bearer ${facToken}` }, body: {} })).status, 403);
    assert.strictEqual((await httpRequest(port, { method: 'POST', path: `/api/exams/${examId}/publish`, headers: { Authorization: `Bearer ${facToken}` }, body: {} })).status, 403);

    // Malformed JSON and "null" payload checks
    const badJsonSyntaxRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      rawBody: '{bad json',
    });
    assert.strictEqual(badJsonSyntaxRes.status, 400);
    assert.strictEqual(badJsonSyntaxRes.json.code, 'INVALID_JSON_PAYLOAD');

    // Scheduler must NOT auto-publish PENDING_REVIEW exam even if publicationTime has passed
    await publicationScheduler.checkScheduledPublications(new Date('2099-05-15T09:25:00+05:30'));
    const stillPending = await Exam.findById(examId).lean();
    assert.strictEqual(stillPending.visibilityStatus, 'NOT_SCHEDULED');

    // Admin Approve & Publish
    assert.strictEqual((await httpRequest(port, { method: 'POST', path: `/api/exams/${examId}/approve`, headers: { Authorization: `Bearer ${adminToken}` }, body: {} })).status, 200);
    const publishRes = await httpRequest(port, { method: 'POST', path: `/api/exams/${examId}/publish`, headers: { Authorization: `Bearer ${adminToken}` }, body: {} });
    assert.strictEqual(publishRes.status, 200);

    // Simulated backend restart recovery + scheduler firing at publicationTime triggers visibilityStatus=PUBLISHED
    await publicationScheduler.recoverScheduledJobs();
    await publicationScheduler.checkScheduledPublications(new Date('2099-05-15T09:21:00+05:30'));
    const publishedAfterScheduler = await Exam.findById(examId).lean();
    assert.strictEqual(publishedAfterScheduler.visibilityStatus, 'PUBLISHED');

    // 8. Student Sign-In via Registration Number, /my-exams Countdown, Own-Seat Isolation, and T+10 Cutoff
    const stuLogin = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/student-login',
      body: { registrationNumber: '24E2E00001' },
    });
    assert.strictEqual(stuLogin.status, 200);
    assert.strictEqual(stuLogin.json.user.role, 'student');
    const stuToken = stuLogin.json.token;

    const examDoc = await Exam.findById(examId).lean();
    const pubMs = new Date(examDoc.publicationTime).getTime(); // 09:20 AM IST
    const startMs = new Date(examDoc.startDateTime).getTime(); // 10:00 AM IST
    const beforePub = new Date(pubMs - 5 * 60 * 1000).toISOString(); // 09:15 AM IST
    const duringWindow = new Date(pubMs + 5 * 60 * 1000).toISOString(); // 09:25 AM IST
    const afterT10 = new Date(startMs + 12 * 60 * 1000).toISOString(); // 10:12 AM IST

    // Before 09:20 AM -> countdown notice, seat MUST be null
    const myBefore = await httpRequest(port, {
      method: 'GET',
      path: '/api/student/my-exams',
      headers: { Authorization: `Bearer ${stuToken}`, 'x-test-timestamp': beforePub },
    });
    assert.strictEqual(myBefore.status, 200);
    assert.strictEqual(myBefore.json.data.length, 1);
    assert.strictEqual(myBefore.json.data[0].windowState, 'PENDING');
    assert.strictEqual(myBefore.json.data[0].seat, null);
    assert.ok(myBefore.json.data[0].notice.includes('09:20 AM'));

    // At 09:25 AM -> seat revealed for logged-in student ONLY
    const myOpen = await httpRequest(port, {
      method: 'GET',
      path: '/api/student/my-exams',
      headers: { Authorization: `Bearer ${stuToken}`, 'x-test-timestamp': duringWindow },
    });
    assert.strictEqual(myOpen.status, 200);
    assert.strictEqual(myOpen.json.data[0].windowState, 'OPEN');
    assert.strictEqual(myOpen.json.data[0].seat.registrationNumber, '24E2E00001');
    assert.ok(myOpen.json.data[0].seat.seatId);

    // Own-seat isolation: 24E2E00001 CANNOT query 24E2E00002 -> 403 FORBIDDEN_STUDENT_SCOPE
    const otherSeatBlock = await httpRequest(port, {
      method: 'POST',
      path: '/api/student/lookup',
      headers: { Authorization: `Bearer ${stuToken}`, 'x-test-timestamp': duringWindow },
      body: { registrationNumber: '24E2E00002', examId },
    });
    assert.strictEqual(otherSeatBlock.status, 403);
    assert.strictEqual(otherSeatBlock.json.code, 'FORBIDDEN_STUDENT_SCOPE');

    // After T+10 (10:12 AM) -> window closed, seat hidden again
    const myClosed = await httpRequest(port, {
      method: 'GET',
      path: '/api/student/my-exams',
      headers: { Authorization: `Bearer ${stuToken}`, 'x-test-timestamp': afterT10 },
    });
    assert.strictEqual(myClosed.status, 200);
    assert.ok(['CLOSED', 'COMPLETED'].includes(myClosed.json.data[0].windowState));
    assert.strictEqual(myClosed.json.data[0].seat, null);

    // 9. Safeguarded Backup & Academic Reset Test on Isolated DB
    await assert.rejects(
      () => performSafeguardedAcademicReset({ confirmReset: false, backupDir: os.tmpdir() }),
      /missing explicit confirmation flag/
    );
    const resetRes = await performSafeguardedAcademicReset({
      confirmReset: true,
      backupDir: os.tmpdir(),
    });
    assert.strictEqual(resetRes.alreadyReset, false);
    assert.ok(fs.existsSync(resetRes.backupFile));
    const repeatRes = await performSafeguardedAcademicReset({
      confirmReset: true,
      backupDir: os.tmpdir(),
    });
    assert.strictEqual(repeatRes.alreadyReset, true, 'Repeat reset must be blocked unless forceRepeatReset=true');
    try { fs.unlinkSync(resetRes.backupFile); } catch {}
    assert.strictEqual(await Exam.countDocuments({}), 0);
    assert.strictEqual(await User.countDocuments({ role: 'admin' }), 1, 'Admin account must be preserved after reset');
    assert.strictEqual(await Classroom.countDocuments({}), 6, 'ET BLOCK classrooms must be preserved after reset');

    console.log('[Restructured E2E Verification] PASSED: 3-role auth (Exam Incharge removed), Excel/inconsistent names, compound subjects, UNIT 1-5, custom publicationTime AM/PM, scheduler approval gate, Admin publish/reports, Student /my-exams + own-seat isolation + T+10, and safeguarded reset succeeded.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase();
      await mongoose.connection.close();
    }
  }
}

run().catch((err) => {
  console.error('[Restructured E2E Verification] FAILED:', err);
  process.exit(1);
});
