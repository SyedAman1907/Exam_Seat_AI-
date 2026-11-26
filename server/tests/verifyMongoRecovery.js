const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const connectDB = require('../config/db');
const app = require('../app');
const schedulerService = require('../scheduler');
const { protect } = require('../middleware/auth');
const FacultyMapping = require('../models/FacultyMapping');
const Student = require('../models/Student');
const Exam = require('../models/Exam');

async function httpJson(baseUrl, method, urlPath, body = null, token = null) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, rawText: text };
}

async function run() {
  console.log('\n================================================================================');
  console.log('  EXAMSEAT AI — MONGODB ATLAS OUTAGE, DNS ENOTFOUND & RECOVERY TEST');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  let server = null;

  function assert(cond, label, details = '') {
    if (cond) {
      console.log(`  PASS: ${label}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Connect to MongoDB Atlas via connectDB & mount Express app + Scheduler (NO external restart)
    await connectDB();
    schedulerService.start();
    if (schedulerService.activeCyclePromise) {
      await schedulerService.activeCyclePromise;
    }
    connectDB.onReconnect(() => schedulerService.onDatabaseReconnect());

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api`;

    const initialMasterCount = await Student.countDocuments({ examId: { $exists: false } });
    const initialMappingCount = await FacultyMapping.countDocuments({ isCurrent: true });

    // -------------------------------------------------------------------------
    // PART 1: NORMAL OPERATION BEFORE OUTAGE
    // -------------------------------------------------------------------------
    console.log('--- PART 1: Normal Atlas Connection & Health Check ---');
    const healthOk = await httpJson(baseUrl, 'GET', '/health');
    assert(
      healthOk.status === 200 &&
        healthOk.data?.status === 'online' &&
        healthOk.data?.backendStatus === 'online' &&
        healthOk.data?.database?.connected === true &&
        healthOk.data?.database?.name === 'examseat_ai' &&
        typeof healthOk.data?.uptimeSeconds === 'number' &&
        !healthOk.rawText.includes('mongodb+srv://'),
      '1. /api/health reports connected status & hides credentials/URI',
      `db=${healthOk.data?.database?.name}, uptime=${healthOk.data?.uptimeSeconds}s`
    );

    const loginOk = await httpJson(baseUrl, 'POST', '/auth/login', {
      email: 'admin@rgmcet.edu.in',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
    });
    const adminToken = loginOk.data?.token;
    assert(loginOk.status === 200 && Boolean(adminToken), '2. Normal Admin Login succeeds');

    const invalidTokenCheck = await httpJson(baseUrl, 'GET', '/auth/me', null, 'invalid.jwt.token');
    assert(
      invalidTokenCheck.status === 401,
      '2b. Genuinely invalid JWT returns 401 while database is healthy'
    );

    // -------------------------------------------------------------------------
    // PART 2: SIMULATE DNS ENOTFOUND & MONGODB CONNECTION INTERRUPTION
    // -------------------------------------------------------------------------
    console.log('\n--- PART 2: DNS Lookup Failure (ENOTFOUND) & DB Outage Behavior ---');

    const dnsErr = new Error('getaddrinfo ENOTFOUND ac-b5szmug-shard-00-00.e9ptjo1.mongodb.net');
    dnsErr.name = 'MongooseServerSelectionError';
    dnsErr.code = 'ENOTFOUND';
    assert(
      connectDB.isDbConnectivityError(dnsErr) === true,
      '3. isDbConnectivityError identifies getaddrinfo ENOTFOUND DNS errors'
    );

    // Emit realistic runtime error + disconnect Mongoose (without terminating Express server)
    mongoose.connection.emit('error', dnsErr);
    await mongoose.disconnect();

    const healthDown = connectDB.getDbHealth();
    assert(
      healthDown.connected === false &&
        healthDown.lastError?.category === 'DNS_RESOLUTION_FAILURE' &&
        !JSON.stringify(healthDown).includes('mongodb+srv://'),
      '3b. Outage classified accurately as DNS_RESOLUTION_FAILURE (not false IP whitelist) with no secrets exposed',
      `state=${healthDown.stateLabel}, category=${healthDown.lastError?.category}`
    );

    const httpHealthDown = await httpJson(baseUrl, 'GET', '/health');
    assert(
      httpHealthDown.status === 503 &&
        httpHealthDown.data?.status === 'degraded' &&
        httpHealthDown.data?.backendStatus === 'online' &&
        httpHealthDown.data?.database?.connected === false,
      '4. /api/health returns HTTP 503 degraded while backend stays online'
    );

    const loginDown = await httpJson(baseUrl, 'POST', '/auth/login', {
      email: 'admin@rgmcet.edu.in',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
    });
    assert(
      loginDown.status === 503 && loginDown.data?.code === 'DATABASE_UNAVAILABLE',
      '5. Login during DB outage returns HTTP 503 (DATABASE_UNAVAILABLE) cleanly'
    );

    // Valid JWT on protected endpoints during outage MUST return 503 (NEVER 401 logout!)
    const meDown = await httpJson(baseUrl, 'GET', '/auth/me', null, adminToken);
    const studentsDown = await httpJson(baseUrl, 'GET', '/students/database', null, adminToken);
    const mappingsDown = await httpJson(baseUrl, 'GET', '/mappings', null, adminToken);
    const examsDown = await httpJson(baseUrl, 'GET', '/exams?filter=all', null, adminToken);

    assert(
      meDown.status === 503 &&
        meDown.status !== 401 &&
        studentsDown.status === 503 &&
        mappingsDown.status === 503 &&
        examsDown.status === 503 &&
        !Array.isArray(studentsDown.data?.data),
      '6. Protected APIs & /auth/me return 503 (never 401 logout or fake empty arrays) during DB outage'
    );

    // Verify protect() middleware directly handles both invalid JWT (401) and valid JWT during DB outage (503)
    const mockRes = () => {
      const r = { statusCode: 200, body: null };
      r.status = (c) => {
        r.statusCode = c;
        return r;
      };
      r.json = (b) => {
        r.body = b;
        return r;
      };
      return r;
    };
    const rBadJwt = mockRes();
    await protect({ headers: { authorization: 'Bearer bad.jwt' } }, rBadJwt, () => {});
    const rGoodJwtDown = mockRes();
    await protect({ headers: { authorization: `Bearer ${adminToken}` } }, rGoodJwtDown, () => {});
    assert(
      rBadJwt.statusCode === 401 && rGoodJwtDown.statusCode === 503,
      '6b. protect() preserves 401 for bad tokens and 503 for valid tokens during DB outage'
    );

    // Scheduler must pause safely without crashing or overlapping during disconnection
    const schedDownResult = await schedulerService.checkScheduledPublications();
    assert(
      schedDownResult === 0 &&
        schedulerService.isPausedDueToDb === true &&
        schedulerService.isCycleRunning === false,
      '7. Scheduler pauses cleanly during disconnection with no crash or overlapping lock',
      `res=${schedDownResult}, paused=${schedulerService.isPausedDueToDb}, cycleRunning=${schedulerService.isCycleRunning}`
    );

    // -------------------------------------------------------------------------
    // PART 3: AUTOMATIC RECONNECTION & FULL RECOVERY WITHOUT SERVER RESTART
    // -------------------------------------------------------------------------
    console.log('\n--- PART 3: Reconnection & Zero-Restart Full Recovery ---');

    await connectDB({ isReconnectAttempt: true });
    // Allow reconnect listeners to settle
    await new Promise((r) => setTimeout(r, 200));

    const healthRecovered = await httpJson(baseUrl, 'GET', '/health');
    assert(
      healthRecovered.status === 200 &&
        healthRecovered.data?.status === 'online' &&
        healthRecovered.data?.database?.connected === true &&
        schedulerService.isPausedDueToDb === false,
      '8. Atlas reconnected & scheduler resumed automatically without restarting server'
    );

    // Login after reconnection
    const loginRecovered = await httpJson(baseUrl, 'POST', '/auth/login', {
      email: 'admin@rgmcet.edu.in',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
    });
    const recoveredToken = loginRecovered.data?.token;
    assert(
      loginRecovered.status === 200 && Boolean(recoveredToken),
      '9a. Login succeeds immediately after reconnection'
    );

    // Student & Faculty mapping retrieval after reconnection
    const studentsRecovered = await httpJson(
      baseUrl,
      'GET',
      '/students/database?page=1&limit=50',
      null,
      recoveredToken
    );
    const mappingsRecovered = await httpJson(baseUrl, 'GET', '/mappings', null, recoveredToken);
    assert(
      studentsRecovered.status === 200 &&
        studentsRecovered.data?.masterStats?.total === initialMasterCount &&
        mappingsRecovered.status === 200 &&
        mappingsRecovered.data?.count === initialMappingCount,
      '9b. Student data & Faculty mappings recover cleanly with zero data loss',
      `students=${studentsRecovered.data?.masterStats?.total}, mappings=${mappingsRecovered.data?.count}`
    );

    // Fast API endpoints verification after recovery
    const tStart = Date.now();
    const [cancelledRes, publishedRes, dashRes, classroomsRes] = await Promise.all([
      httpJson(baseUrl, 'GET', '/exams?filter=cancelled', null, recoveredToken),
      httpJson(baseUrl, 'GET', '/exams?filter=published', null, recoveredToken),
      httpJson(baseUrl, 'GET', '/dashboard/stats', null, recoveredToken),
      httpJson(baseUrl, 'GET', '/classrooms', null, recoveredToken),
    ]);
    const totalParallelMs = Date.now() - tStart;
    assert(
      cancelledRes.status === 200 &&
        publishedRes.status === 200 &&
        dashRes.status === 200 &&
        classroomsRes.status === 200 &&
        classroomsRes.data?.count === 6 &&
        totalParallelMs < 6000,
      '9c. Cancelled, Published, Dashboard Stats & Classrooms recover cleanly in parallel',
      `${totalParallelMs}ms total across 4 concurrent APIs`
    );

    // Examination creation + listing + safe cleanup of ONLY our test draft exam
    const firstMapping = mappingsRecovered.data?.mappings?.[0];
    const createRes = await httpJson(
      baseUrl,
      'POST',
      '/exams/create-centralized',
      {
        examName: 'Post-Recovery Test Draft Exam',
        subjectName: firstMapping.subjectName,
        subjectCode: firstMapping.subjectCode,
        examDate: '2026-12-28',
        startTime: '09:30 AM',
        endTime: '11:30 AM',
        session: 'FN',
        group: firstMapping.group || 'Group A',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        selectedMappingIds: [firstMapping._id],
        saveAsDraft: true,
      },
      recoveredToken
    );
    const createdExamId = createRes.data?.data?._id;
    const listDraftsRes = await httpJson(baseUrl, 'GET', '/exams?filter=draft', null, recoveredToken);
    const listedCreated = (listDraftsRes.data?.data || []).some((e) => e._id === createdExamId);

    // Clean up ONLY the test draft exam created by this verification script
    if (createdExamId) {
      await httpJson(baseUrl, 'DELETE', `/exams/${createdExamId}`, null, recoveredToken);
      await Exam.findByIdAndDelete(createdExamId);
    }

    assert(
      createRes.status === 201 && Boolean(createdExamId) && listedCreated,
      '9d. Examination creation and listing recover seamlessly after Atlas reconnection'
    );
  } finally {
    connectDB.markShuttingDown();
    schedulerService.stop();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      await mongoose.disconnect();
    } catch {}
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal recovery test failure:', err);
  process.exit(1);
});
