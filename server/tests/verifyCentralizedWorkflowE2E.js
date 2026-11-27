/**
 * End-to-End Verification for Centralized Examination Creation, Reports & Approval Workflow.
 * Uses an isolated test database (never touches production MongoDB Atlas data).
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const vm = require('vm');

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

  const incharge = await User.create({
    name: 'Test Exam Incharge',
    email: 'testincharge@rgmcet.edu.in',
    passwordHash: await User.hashPassword('TestIncharge@123'),
    role: 'exam_incharge',
    department: 'Computer Science and Engineering',
    isActive: true,
  });

  const faculty = await User.create({
    name: 'Faculty A1',
    email: 'facultya1@rgmcet.edu.in',
    passwordHash: await User.hashPassword('TestFaculty@123'),
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
      facultyName: `Faculty ${sec}`,
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

  return { admin, incharge, faculty, mappingIds };
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

  // Actual null & empty bodies preserve null without throwing or converting to {}
  assert.strictEqual(safeParse(null), null);
  assert.strictEqual(safeParse(undefined), null);
  assert.strictEqual(safeParse(''), null);
  assert.strictEqual(safeParse('   '), null);
  assert.strictEqual(safeParse('null'), null);

  // Double-encoded "null" safely resolves to null without blindly parsing into objects
  assert.strictEqual(safeParse('"null"'), null);

  // Already-parsed object is returned as-is without re-parsing
  const obj = { success: true, data: [] };
  assert.strictEqual(safeParse(obj), obj);

  // Non-JSON / HTML / malformed strings do not throw SyntaxError
  assert.strictEqual(safeParse('<!DOCTYPE html><html></html>'), '<!DOCTYPE html><html></html>');
  assert.strictEqual(safeParse('{invalid'), '{invalid');

  // Valid JSON string parses once into structured object
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
  await connectDB();

  const { mappingIds } = await seedTestEnvironment();
  const app = require('../app');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    // 1. Login as Exam Incharge
    const incLogin = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'testincharge@rgmcet.edu.in', password: 'TestIncharge@123' },
    });
    assert.strictEqual(incLogin.status, 200);
    assert.strictEqual(incLogin.jsonValid, true);
    const incToken = incLogin.json.token;
    assert.ok(incToken);

    // 2. Create centralized examination (3 sections, 216 students)
    const createPayload = {
      academicYear: '2026-2027',
      year: 'III Year',
      semester: 'I Semester',
      subjectName: 'Compiler Design',
      subjectCode: '20A05E2E',
      examName: 'III B.Tech I Sem E2E Test Exam',
      examDate: '2099-05-15',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'AM',
      group: 'Group A',
      selectedSections: ['A1', 'A2', 'A3'],
      selectedMappingIds: mappingIds,
    };

    const createRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${incToken}` },
      body: createPayload,
    });
    assert.strictEqual(createRes.status, 201, `Create failed: ${JSON.stringify(createRes.json)}`);
    assert.strictEqual(createRes.jsonValid, true);
    assert.strictEqual(createRes.json.json, undefined);
    assert.strictEqual(createRes.json.success, true);
    assert.strictEqual(createRes.json.data.studentCount, 216);
    assert.strictEqual(createRes.json.data.sectionAllocations.length, 3);
    assert.strictEqual(createRes.json.data.approvalStatus, 'PENDING_REVIEW');
    const examId = createRes.json.data._id;

    // 3. Duplicate submission must return 409 Conflict and NOT create a second exam
    const dupRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/exams/create-centralized',
      headers: { Authorization: `Bearer ${incToken}` },
      body: createPayload,
    });
    assert.strictEqual(dupRes.status, 409);
    const examCount = await Exam.countDocuments({ subjectCode: '20A05E2E', isDeleted: { $ne: true } });
    assert.strictEqual(examCount, 1, 'Exactly one parent examination must exist');

    // 4. Refresh examination list, pending review list, and dashboard stats
    const [allRes, pendingRes, statsRes] = await Promise.all([
      httpRequest(port, { method: 'GET', path: '/api/exams?filter=all', headers: { Authorization: `Bearer ${incToken}` } }),
      httpRequest(port, { method: 'GET', path: '/api/exams?filter=pending', headers: { Authorization: `Bearer ${incToken}` } }),
      httpRequest(port, { method: 'GET', path: '/api/dashboard/stats', headers: { Authorization: `Bearer ${incToken}` } }),
    ]);
    for (const r of [allRes, pendingRes, statsRes]) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.jsonValid, true);
      assert.strictEqual(r.json.success, true);
    }
    assert.strictEqual(allRes.json.data.length, 1);
    assert.strictEqual(pendingRes.json.data.length, 1);
    assert.strictEqual(statsRes.json.data.pendingApprovals, 1);

    // 5. Open examination details
    const detailRes = await httpRequest(port, {
      method: 'GET',
      path: `/api/exams/${examId}`,
      headers: { Authorization: `Bearer ${incToken}` },
    });
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.jsonValid, true);
    assert.strictEqual(detailRes.json.data.sectionAllocations.length, 3);
    assert.strictEqual(detailRes.json.data.studentCount, 216);

    // 5b. Download Section A1 Attendance PDF
    const secPdfRes = await httpRequest(port, {
      method: 'GET',
      path: `/api/reports/${examId}/section-attendance-pdf/A1`,
      headers: { Authorization: `Bearer ${incToken}` },
    });
    assert.strictEqual(secPdfRes.status, 200);
    assert.strictEqual(secPdfRes.buffer.slice(0, 5).toString('utf8'), '%PDF-', 'Section Attendance PDF must be valid');

    // 6. Download Attendance ZIP
    const zipRes = await httpRequest(port, {
      method: 'GET',
      path: `/api/reports/${examId}/attendance-zip?sections=A1,A2,A3`,
      headers: { Authorization: `Bearer ${incToken}` },
    });
    assert.strictEqual(zipRes.status, 200);
    assert.strictEqual(zipRes.buffer.slice(0, 2).toString('utf8'), 'PK', 'Attendance ZIP must start with PK signature');

    // 7. Download Seating Blueprint PDF
    const pdfRes = await httpRequest(port, {
      method: 'GET',
      path: `/api/reports/${examId}/seating-pdf`,
      headers: { Authorization: `Bearer ${incToken}` },
    });
    assert.strictEqual(pdfRes.status, 200);
    assert.strictEqual(pdfRes.buffer.slice(0, 5).toString('utf8'), '%PDF-', 'Seating Blueprint must be a valid PDF');

    // 8. Admin login + Approve & Review
    const adminLogin = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'testadmin@rgmcet.edu.in', password: 'TestAdmin@123' },
    });
    assert.strictEqual(adminLogin.status, 200);
    const adminToken = adminLogin.json.token;

    // 8a. Unauthorized Exam Incharge must NOT be able to publish (403)
    const unauthPublishRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${incToken}` },
      body: {},
    });
    assert.strictEqual(unauthPublishRes.status, 403, 'Exam Incharge must receive 403 on publish');
    assert.strictEqual(unauthPublishRes.jsonValid, true);

    // 8b. Literal "null" JSON payload must fail cleanly with structured INVALID_JSON_PAYLOAD 400
    const badJsonPublishRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      rawBody: 'null',
    });
    assert.strictEqual(badJsonPublishRes.status, 400);
    assert.strictEqual(badJsonPublishRes.jsonValid, true);
    assert.strictEqual(badJsonPublishRes.json.code, 'INVALID_JSON_PAYLOAD');

    // 8c. Live availability GET detects booked conflict and open date cleanly
    const conflictAvailRes = await httpRequest(port, {
      method: 'GET',
      path: `/api/exams/check-availability?examDate=${encodeURIComponent(createPayload.examDate)}&startTime=09:00%20AM&endTime=12:00%20PM&session=AM&group=Group%20A&allowOvernight=false`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(conflictAvailRes.status, 200);
    assert.strictEqual(conflictAvailRes.json.available, false);
    assert.ok(Array.isArray(conflictAvailRes.json.conflicts) && conflictAvailRes.json.conflicts.length > 0);

    const openAvailRes = await httpRequest(port, {
      method: 'GET',
      path: `/api/exams/check-availability?examDate=2028-12-20&startTime=09:00%20AM&endTime=12:00%20PM&session=AM&group=Group%20A&allowOvernight=false`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(openAvailRes.status, 200);
    assert.strictEqual(openAvailRes.json.available, true);

    // 8d. Admin attempting to publish a PENDING_REVIEW exam BEFORE approval must fail cleanly (400 REQUIRES_ADMIN_APPROVAL)
    const publishPendingRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    assert.strictEqual(publishPendingRes.status, 400);
    assert.strictEqual(publishPendingRes.json.code, 'REQUIRES_ADMIN_APPROVAL');

    // 8e. Admin approves the examination first (POST /api/exams/:id/approve)
    const approveRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/approve`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveRes.jsonValid, true);
    assert.strictEqual(approveRes.json.success, true);
    assert.strictEqual(approveRes.json.data.approvalStatus, 'APPROVED');

    // 8f. Admin publishes the approved examination (POST /api/exams/:id/publish)
    const publishRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    assert.strictEqual(publishRes.status, 200);
    assert.strictEqual(publishRes.jsonValid, true);
    assert.strictEqual(publishRes.json.success, true);
    assert.ok(publishRes.json.data.publicationConfirmedAt);

    // 8g. Repeat publish on already published/confirmed exam must be blocked cleanly (409 ALREADY_PUBLISHED),
    // and CANCELLED / COMPLETED exams must return 400 EXAM_CANCELLED / EXAM_COMPLETED
    const repeatScheduledRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    assert.strictEqual(repeatScheduledRes.status, 409);
    assert.strictEqual(repeatScheduledRes.json.code, 'ALREADY_PUBLISHED');

    await Exam.findByIdAndUpdate(examId, { $set: { status: 'CANCELLED', approvalStatus: 'CANCELLED' } });
    const cancelledPublishRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    assert.strictEqual(cancelledPublishRes.status, 400);
    assert.strictEqual(cancelledPublishRes.json.code, 'EXAM_CANCELLED');

    await Exam.findByIdAndUpdate(examId, { $set: { status: 'COMPLETED', approvalStatus: 'APPROVED' } });
    const completedPublishRes = await httpRequest(port, {
      method: 'POST',
      path: `/api/exams/${examId}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    assert.strictEqual(completedPublishRes.status, 400);
    assert.strictEqual(completedPublishRes.json.code, 'EXAM_COMPLETED');
    await Exam.findByIdAndUpdate(examId, { $set: { status: 'SCHEDULED', approvalStatus: 'APPROVED', visibilityStatus: 'SCHEDULED' } });

    // 8h. Refresh dashboard and examination list after publishing; verify sections & students intact
    const [postPubAll, postPubStats] = await Promise.all([
      httpRequest(port, { method: 'GET', path: '/api/exams?filter=all', headers: { Authorization: `Bearer ${adminToken}` } }),
      httpRequest(port, { method: 'GET', path: '/api/dashboard/stats', headers: { Authorization: `Bearer ${adminToken}` } }),
    ]);
    assert.strictEqual(postPubAll.status, 200);
    assert.strictEqual(postPubAll.json.data[0].sectionAllocations.length, 3);
    assert.strictEqual(postPubAll.json.data[0].studentCount, 216);
    assert.strictEqual(postPubStats.status, 200);
    assert.strictEqual(postPubStats.json.data.pendingApprovals, 0);

    // 9. Faculty login + scoped examination access + Logout & re-login
    const facLogin = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'facultya1@rgmcet.edu.in', password: 'TestFaculty@123' },
    });
    assert.strictEqual(facLogin.status, 200);
    const facToken = facLogin.json.token;

    const facExamsRes = await httpRequest(port, {
      method: 'GET',
      path: '/api/exams?filter=all',
      headers: { Authorization: `Bearer ${facToken}` },
    });
    assert.strictEqual(facExamsRes.status, 200);
    assert.strictEqual(facExamsRes.json.data.length, 1);

    const logoutRes = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/logout',
      headers: { Authorization: `Bearer ${facToken}` },
    });
    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.json.success, true);

    // 10. Student Portal T-20 Early Access, Active Window & T+10 Closure + Concurrent Read-Only Lookups
    const Allocation = require('../models/Allocation');
    const examDoc = await Exam.findById(examId).lean();
    const startMs = new Date(examDoc.startDateTime).getTime();
    const tMinus25 = new Date(startMs - 25 * 60 * 1000).toISOString();
    const tMinus15 = new Date(startMs - 15 * 60 * 1000).toISOString();
    const tPlus12 = new Date(startMs + 12 * 60 * 1000).toISOString();
    const sampleReg = '24E2E00001';

    const beforeT20Active = await httpRequest(port, {
      method: 'GET',
      path: '/api/student/active-exams',
      headers: { 'x-test-timestamp': tMinus25 },
    });
    assert.strictEqual(beforeT20Active.status, 200);
    assert.strictEqual(beforeT20Active.json.data[0].windowState, 'PENDING');

    const beforeT20Lookup = await httpRequest(port, {
      method: 'POST',
      path: '/api/student/lookup',
      headers: { 'x-test-timestamp': tMinus25 },
      body: { registrationNumber: sampleReg, examId },
    });
    assert.strictEqual(beforeT20Lookup.status, 403);
    assert.strictEqual(beforeT20Lookup.json.isPending, true);

    const openActive = await httpRequest(port, {
      method: 'GET',
      path: '/api/student/active-exams',
      headers: { 'x-test-timestamp': tMinus15 },
    });
    assert.strictEqual(openActive.status, 200);
    assert.strictEqual(openActive.json.data[0].windowState, 'OPEN');

    // 20 concurrent student lookups during active window must succeed without mutating Allocation count
    const allocCountBefore = await Allocation.countDocuments({ examId });
    const concurrentLookups = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        httpRequest(port, {
          method: 'POST',
          path: '/api/student/lookup',
          headers: { 'x-test-timestamp': tMinus15 },
          body: { registrationNumber: `24E2E${String(i + 1).padStart(5, '0')}`, examId },
        })
      )
    );
    for (const lr of concurrentLookups) {
      assert.strictEqual(lr.status, 200);
      assert.strictEqual(lr.json.success, true);
      assert.ok(lr.json.data.seatId);
    }
    const allocCountAfter = await Allocation.countDocuments({ examId });
    assert.strictEqual(allocCountAfter, allocCountBefore, 'Concurrent lookups must not create allocations');

    const closedLookup = await httpRequest(port, {
      method: 'POST',
      path: '/api/student/lookup',
      headers: { 'x-test-timestamp': tPlus12 },
      body: { registrationNumber: sampleReg, examId },
    });
    assert.strictEqual(closedLookup.status, 403);
    assert.strictEqual(closedLookup.json.isWindowClosed, true);

    console.log('[Centralized Workflow E2E] PASSED: All 20 workflow checks (logins, logout, creation, duplicate guard, refreshes, details, section PDF, ZIP, seating PDF, Admin approval, T-20/T+10 rules, concurrent student lookups) succeeded.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase();
      await mongoose.connection.close();
    }
  }
}

run().catch((err) => {
  console.error('[Centralized Workflow E2E] FAILED:', err);
  process.exit(1);
});
