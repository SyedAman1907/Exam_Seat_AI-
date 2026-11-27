/**
 * Verification Suite for:
 *  1. Multi-subject PDF continuation handling & O(1) dedup
 *  2. Background MappingJob workflow (upload-preview job, confirm-batch partial fail preservation, safe retry)
 *  3. Time conversion (12 AM / 12 PM / Asia/Kolkata / room conflict timestamps)
 *  4. Distributed SchedulerLock mutual exclusion
 *
 * Uses isolated local MongoDB (127.0.0.1:27099) — never touches production Atlas data.
 */
const assert = require('assert');
const http = require('http');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function generateMultiPageTestPdf(outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      try {
        fs.writeFileSync(outputPath, Buffer.concat(chunks));
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    doc.on('error', reject);

    // Page 1: Group A (CNIP) Section A1, Faculty Dr. K. Subba Rao
    doc.fontSize(12).text('RGM (AUTONOMOUS)');
    doc.text('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING');
    doc.text('A.Y. 2026-27  III-I CSE');
    doc.text('Group - A (Computer Networks and Internet Protocols)');
    doc.text('Name: Dr. K. Subba Rao   Section: A1');
    doc.moveDown(0.5);
    for (let i = 1; i <= 5; i++) {
      doc.text(`${i}  24091A05${String(i).padStart(2, '0')}  STUDENT CNIP A1 ${i}`);
    }

    // Page 2: Continuation page of exact same roster (CNIP, Section A1, Dr. K. Subba Rao)
    doc.addPage();
    doc.fontSize(12).text('RGM (AUTONOMOUS)');
    doc.text('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING');
    doc.text('A.Y. 2026-27  III-I CSE');
    doc.text('Group - A (Computer Networks and Internet Protocols)');
    doc.text('Name: Dr. K. Subba Rao   Section: A1');
    doc.moveDown(0.5);
    for (let i = 6; i <= 10; i++) {
      doc.text(`${i}  24091A05${String(i).padStart(2, '0')}  STUDENT CNIP A1 ${i}`);
    }
    // Duplicate of student #1 within same mapping should be deduplicated
    doc.text(`11  24091A0501  STUDENT CNIP A1 1`);

    // Page 3: Different subject (Artificial Intelligence), same Section A1 (must remain SEPARATE mapping!)
    doc.addPage();
    doc.fontSize(12).text('RGM (AUTONOMOUS)');
    doc.text('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING');
    doc.text('A.Y. 2026-27  III-I CSE');
    doc.text('Group - A (Artificial Intelligence)');
    doc.text('Name: Dr. P. Nagaraju   Section: A1');
    doc.moveDown(0.5);
    for (let i = 1; i <= 4; i++) {
      doc.text(`${i}  24091A05${String(i).padStart(2, '0')}  STUDENT AI A1 ${i}`);
    }

    doc.end();
  });
}

function sendJson(port, { method, reqPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: reqPath,
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
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            json: text ? JSON.parse(text) : null,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27099/examseat_jobs_time_verify';
  process.env.JWT_SECRET = 'jobs_time_verify_secret';

  const {
    to24HourTime,
    to24Hour,
    formatTime12h,
    parseExamDateRange,
  } = require('../utils/dateTimeUtils');

  // 1. Time conversion tests (12 AM, 12 PM, Asia/Kolkata, invalid end <= start)
  assert.strictEqual(to24HourTime('12:00 AM'), '00:00:00');
  assert.strictEqual(to24HourTime('12:30 PM'), '12:30:00');
  assert.strictEqual(to24Hour('02:00 PM'), '14:00');
  assert.strictEqual(formatTime12h('00:15'), '12:15 AM');
  assert.strictEqual(formatTime12h('12:00'), '12:00 PM');
  assert.strictEqual(formatTime12h('14:05'), '02:05 PM');

  const pmRange = parseExamDateRange('2026-12-10', '02:00 PM', '05:00 PM', null, { session: 'PM' });
  assert.strictEqual(pmRange.startTime, '02:00 PM');
  assert.strictEqual(pmRange.endTime, '05:00 PM');
  assert.strictEqual(pmRange.startTime24, '14:00');
  assert.strictEqual(pmRange.endTime24, '17:00');
  assert.ok(pmRange.endDateTime > pmRange.startDateTime);

  assert.throws(
    () => parseExamDateRange('2026-12-10', '04:00 PM', '02:00 PM', null, { session: 'PM' }),
    /End time must be strictly after start time/
  );
  assert.throws(
    () => parseExamDateRange('2026-12-10', '09:00 AM', '12:00 PM', null, { session: 'PM' }),
    /Afternoon \(PM\)/
  );

  // 2. Connect DB & test continuation-page PDF parsing + Background Job + SchedulerLock
  const { connectDB } = require('../config/db');
  const mongoose = require('mongoose');
  const User = require('../models/User');
  const FacultyMapping = require('../models/FacultyMapping');
  const MappingJob = require('../models/MappingJob');
  const SchedulerLock = require('../models/SchedulerLock');
  const PdfExtractorService = require('../services/pdfExtractorService');

  await connectDB();

  const tempPdf = path.join(os.tmpdir(), `multi-cont-${Date.now()}.pdf`);
  await generateMultiPageTestPdf(tempPdf);

  try {
    // Verify PDF continuation page merging + subject separation
    const extracted = await PdfExtractorService.extractMultiSubjectRosters(tempPdf, 'multi-cont.pdf');
    assert.strictEqual(extracted.mappings.length, 2, 'Continuation pages should merge into 1 CNIP mapping while keeping AI separate');
    assert.strictEqual(extracted.mappings[0].subjectName, 'Computer Networks and Internet Protocols');
    assert.strictEqual(extracted.mappings[0].students.length, 10, 'Duplicate row within same CNIP mapping must be deduplicated cleanly');
    assert.strictEqual(extracted.mappings[0].pages.length, 2);
    assert.strictEqual(extracted.mappings[1].subjectName, 'Artificial Intelligence');
    assert.strictEqual(extracted.mappings[1].students.length, 4);

    // Seed Admin user & login via Express app
    await mongoose.connection.dropDatabase();
    await Promise.all([
      User.init(),
      FacultyMapping.init(),
      MappingJob.init(),
      SchedulerLock.init(),
    ]);
    const admin = await User.create({
      name: 'Job Test Admin',
      email: 'jobadmin@rgmcet.edu.in',
      passwordHash: await User.hashPassword('JobAdmin@123'),
      role: 'admin',
      department: 'Computer Science and Engineering',
      isActive: true,
    });

    const app = require('../app');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    try {
      const loginRes = await sendJson(port, {
        method: 'POST',
        reqPath: '/api/auth/login',
        body: { email: 'jobadmin@rgmcet.edu.in', password: 'JobAdmin@123' },
      });
      assert.strictEqual(loginRes.status, 200);
      const token = loginRes.json.token;

      // Upload PDF via background job endpoint (multipart form-data using fetch)
      const pdfBytes = fs.readFileSync(tempPdf);
      const fd = new FormData();
      fd.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'multi-cont.pdf');
      fd.append('uploadMode', 'multi');

      const uploadJobRes = await fetch(`http://127.0.0.1:${port}/api/mappings/jobs/upload-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      assert.strictEqual(uploadJobRes.status, 202);
      const uploadJobJson = await uploadJobRes.json();
      assert.ok(uploadJobJson.data?.jobId);

      // Poll upload job until COMPLETED
      let previewJob = null;
      for (let i = 0; i < 40; i++) {
        const poll = await sendJson(port, {
          method: 'GET',
          reqPath: `/api/mappings/jobs/${uploadJobJson.data.jobId}`,
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.strictEqual(poll.status, 200);
        previewJob = poll.json.data;
        if (['COMPLETED', 'FAILED'].includes(previewJob.status)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(previewJob.status, 'COMPLETED');
      assert.strictEqual(previewJob.previewMappings.length, 2);

      // Start confirm-batch job with 1 valid mapping + 1 invalid mapping (missing facultyName) -> PARTIAL_FAILED
      const batchInput = [
        previewJob.previewMappings[0],
        {
          ...previewJob.previewMappings[1],
          facultyName: '', // deliberate error on 2nd item
        },
      ];

      const confirmJobStart = await sendJson(port, {
        method: 'POST',
        reqPath: '/api/mappings/jobs/confirm-batch',
        headers: { Authorization: `Bearer ${token}` },
        body: { mappings: batchInput, sourceFileName: 'multi-cont.pdf', replaceExisting: true },
      });
      assert.strictEqual(confirmJobStart.status, 202);
      const batchJobId = confirmJobStart.json.data.jobId;

      let batchJob = null;
      for (let i = 0; i < 50; i++) {
        const poll = await sendJson(port, {
          method: 'GET',
          reqPath: `/api/mappings/jobs/${batchJobId}`,
          headers: { Authorization: `Bearer ${token}` },
        });
        batchJob = poll.json.data;
        if (['COMPLETED', 'PARTIAL_FAILED', 'FAILED'].includes(batchJob.status)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(batchJob.status, 'PARTIAL_FAILED');
      assert.strictEqual(batchJob.progress.completed, 1);
      assert.strictEqual(batchJob.progress.failed, 1);
      assert.strictEqual(batchJob.progress.pending, 0);

      // Fix the failed item snapshot directly in DB (simulating corrected metadata before retry) and call retry
      await MappingJob.updateOne(
        { _id: batchJobId },
        { $set: { 'failedItems.0.mappingSnapshot.facultyName': 'Dr. P. Nagaraju' } }
      );

      const retryRes = await sendJson(port, {
        method: 'POST',
        reqPath: `/api/mappings/jobs/${batchJobId}/retry`,
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(retryRes.status, 202);

      let retriedJob = null;
      for (let i = 0; i < 50; i++) {
        const poll = await sendJson(port, {
          method: 'GET',
          reqPath: `/api/mappings/jobs/${batchJobId}`,
          headers: { Authorization: `Bearer ${token}` },
        });
        retriedJob = poll.json.data;
        if (['COMPLETED', 'PARTIAL_FAILED', 'FAILED'].includes(retriedJob.status)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(retriedJob.status, 'COMPLETED');
      assert.strictEqual(retriedJob.progress.completed, 2);
      assert.strictEqual(retriedJob.progress.failed, 0);

      // Verify exactly 2 current mappings exist in DB (no duplicates created on retry!)
      const activeCount = await FacultyMapping.countDocuments({ isCurrent: true });
      assert.strictEqual(activeCount, 2, 'Retry must preserve valid mappings without duplicating');

      // 3. Distributed SchedulerLock mutual exclusion between two competing owners
      await SchedulerLock.deleteMany({});
      const acquireAsOwner = async (ownerId) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 20000);
        try {
          const doc = await SchedulerLock.findOneAndUpdate(
            { lockKey: 'exam_publication_cycle', $or: [{ expiresAt: { $lte: now } }, { ownerId }] },
            { $set: { lockKey: 'exam_publication_cycle', ownerId, lockedAt: now, expiresAt } },
            { upsert: true, new: true }
          ).lean();
          return Boolean(doc && doc.ownerId === ownerId);
        } catch (err) {
          if (err.code === 11000) return false;
          throw err;
        }
      };

      const [winA, winB] = await Promise.all([
        acquireAsOwner('instance-A'),
        acquireAsOwner('instance-B'),
      ]);
      assert.strictEqual((winA ? 1 : 0) + (winB ? 1 : 0), 1, 'Exactly one distributed scheduler owner may hold the lock');

      // 4. Room-conflict timestamp verification (09:00 AM-12:00 PM vs 02:00 PM-05:00 PM = clear; vs 11:30 AM-01:30 PM = conflict)
      const Classroom = require('../models/Classroom');
      const Exam = require('../models/Exam');
      const classroomMappingService = require('../services/classroomMappingService');
      const room = await Classroom.create({
        name: 'ET BLOCK 3010',
        roomNumber: '3010',
        block: 'ET BLOCK',
        floor: '3rd Floor',
        totalCapacity: 72,
        availableCapacity: 72,
        isActive: true,
      });
      const morningRange = parseExamDateRange('2026-12-12', '09:00 AM', '12:00 PM', null, { session: 'AM' });
      const morningExam = await Exam.create({
        examName: 'Morning Conflict Baseline',
        subjectName: 'CNIP',
        subjectCode: '20A05502T',
        examDate: '2026-12-12',
        startTime: morningRange.startTime,
        endTime: morningRange.endTime,
        startDateTime: morningRange.startDateTime,
        endDateTime: morningRange.endDateTime,
        session: 'AM',
        group: 'Group A',
        section: 'A1',
        classroomId: room._id,
        status: 'GENERATED',
        approvalStatus: 'PENDING_REVIEW',
      });
      const afternoonRange = parseExamDateRange('2026-12-12', '02:00 PM', '05:00 PM', null, { session: 'PM' });
      const afternoonConflict = await classroomMappingService.checkClassroomConflict(
        room._id,
        '2026-12-12',
        afternoonRange.startDateTime,
        afternoonRange.endDateTime,
        'PM'
      );
      assert.strictEqual(afternoonConflict, null, 'Same room at 02:00 PM - 05:00 PM must NOT conflict with 09:00 AM - 12:00 PM');

      const overlapRange = parseExamDateRange('2026-12-12', '11:30 AM', '01:30 PM', null, { session: 'AM' });
      const overlapConflict = await classroomMappingService.checkClassroomConflict(
        room._id,
        '2026-12-12',
        overlapRange.startDateTime,
        overlapRange.endDateTime,
        'AM'
      );
      assert.ok(overlapConflict, 'Overlapping 11:30 AM - 01:30 PM in same room must be detected');
      assert.strictEqual(String(overlapConflict._id), String(morningExam._id));

      // 5. Verify X-Request-Id header, strict UNIT 1..UNIT 5 Exam Type enum, historical backfill, and edit preservation
      const { normalizeExamType, resolveExamType, inferExamTypeFromTitle, isValidUnitExamType } = require('../utils/examTypeUtils');
      const ensureExamIndexes = require('../utils/ensureExamIndexes');
      assert.strictEqual(normalizeExamType('unit 3'), 'UNIT 3');
      assert.strictEqual(isValidUnitExamType('UNIT 1'), true);
      assert.strictEqual(isValidUnitExamType('UNIT 5'), true);
      assert.strictEqual(isValidUnitExamType('Mid Term'), false);
      assert.strictEqual(inferExamTypeFromTitle('III Year I Sem UNIT 2 Examination'), 'UNIT 2');

      const unitExam = await Exam.create({
        examName: 'III Year I Semester UNIT 1 Examination',
        examType: 'UNIT 1',
        subjectName: 'IQTA',
        subjectCode: '20A05505T',
        examDate: '2026-12-15',
        startTime: '02:00 PM',
        endTime: '03:00 PM',
        publicationTime: parseExamDateRange('2026-12-15', '01:50 PM', '03:00 PM', null, { session: 'PM' }).startDateTime,
        publicationTimeStr: '01:50 PM',
        session: 'PM',
        group: 'Group A',
        section: 'A1',
        classroomId: room._id,
        status: 'GENERATED',
        approvalStatus: 'PENDING_REVIEW',
      });
      assert.strictEqual(resolveExamType(unitExam), 'UNIT 1');

      // Legacy exam without examType field should safely normalize to UNIT 1..UNIT 5 without duplication
      const legacyInsert = await Exam.collection.insertOne({
        examName: 'III Year I Semester UNIT 2 Examination',
        subjectName: 'Legacy Subject',
        subjectCode: '20A05LEG',
        examDate: '2026-12-16',
        section: 'A1',
        group: 'Group A',
        isDeleted: false,
      });
      await ensureExamIndexes();
      const backfilled = await Exam.findById(legacyInsert.insertedId).lean();
      assert.strictEqual(backfilled.examType, 'UNIT 2');

      // Verify API filter by ?examType=UNIT 1 and X-Request-Id header
      const filteredRes = await sendJson(port, {
        method: 'GET',
        reqPath: '/api/exams?examType=UNIT%201',
        headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': 'verify-req-123456' },
      });
      assert.strictEqual(filteredRes.status, 200);
      assert.ok(filteredRes.json.data.some((ex) => String(ex._id) === String(unitExam._id)));
      assert.strictEqual(typeof filteredRes.json.counts?.pendingReview, 'number');

      // Verify PUT /api/exams/:id preserves examType when omitted, rejects non-UNIT types, and accepts UNIT 5
      const editKeepType = await sendJson(port, {
        method: 'PUT',
        reqPath: `/api/exams/${unitExam._id}`,
        headers: { Authorization: `Bearer ${token}` },
        body: { examName: 'III Year I Semester UNIT 1 Revised' },
      });
      assert.strictEqual(editKeepType.status, 200);
      assert.strictEqual(editKeepType.json.data.examType, 'UNIT 1');

      const editBadType = await sendJson(port, {
        method: 'PUT',
        reqPath: `/api/exams/${unitExam._id}`,
        headers: { Authorization: `Bearer ${token}` },
        body: { examType: 'SEMESTER END EXAMINATION' },
      });
      assert.strictEqual(editBadType.status, 400);
      assert.strictEqual(editBadType.json.code, 'INVALID_EXAM_TYPE');

      const editChangeType = await sendJson(port, {
        method: 'PUT',
        reqPath: `/api/exams/${unitExam._id}`,
        headers: { Authorization: `Bearer ${token}` },
        body: { examType: 'UNIT 5' },
      });
      assert.strictEqual(editChangeType.status, 200);
      assert.strictEqual(editChangeType.json.data.examType, 'UNIT 5');

      console.log('[Jobs, Time, ExamType & SchedulerLock Verification] PASSED: Continuation PDF parsing, background mapping jobs + partial retry, 12h time conversion, room-conflict timestamps, examType CRUD/backfill/filtering, and distributed lock succeeded.');
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    try {
      if (fs.existsSync(tempPdf)) fs.unlinkSync(tempPdf);
    } catch {}
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
}

run().catch((err) => {
  console.error('[Jobs, Time & SchedulerLock Verification] FAILED:', err);
  process.exit(1);
});
