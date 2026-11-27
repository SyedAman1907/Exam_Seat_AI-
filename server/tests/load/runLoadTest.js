/**
 * Repeatable HTTP Load Test Runner for ExamSeat AI Student Seat Finder
 *
 * Simulates realistic student actions at 50, 100, 250, and 500 concurrent users:
 *   1. Open Student Seat Finder -> GET /api/student/active-exams
 *   2. Submit registration number -> POST /api/student/lookup
 *   3. Refresh schedule -> GET /api/student/active-exams
 *
 * Usage:
 *   Isolated local benchmark (uses separate `examseat_loadtest` DB, never touches production):
 *     node tests/load/runLoadTest.js --isolated
 *
 *   Target external/staging URL (read-only schedule + synthetic regNo):
 *     node tests/load/runLoadTest.js --target https://exam-seat-ai-1.onrender.com
 */
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

function parseArgs() {
  const args = process.argv.slice(2);
  const isolated = args.includes('--isolated') || !args.includes('--target');
  const targetIdx = args.indexOf('--target');
  const targetUrl = targetIdx >= 0 && args[targetIdx + 1] ? args[targetIdx + 1] : null;
  const levelsIdx = args.indexOf('--levels');
  const levels =
    levelsIdx >= 0 && args[levelsIdx + 1]
      ? args[levelsIdx + 1].split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => n > 0)
      : [50, 100, 250, 500];
  return { isolated: targetUrl ? false : isolated, targetUrl, levels };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function createRequester(baseUrl) {
  const urlObj = new URL(baseUrl);
  const isHttps = urlObj.protocol === 'https:';
  const mod = isHttps ? https : http;
  const agent = new mod.Agent({ keepAlive: true, maxSockets: 600, maxFreeSockets: 100 });

  return function request(method, reqPath, bodyObj = null) {
    const startNs = process.hrtime.bigint();
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = {
      Accept: 'application/json',
      ...(payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : {}),
    };

    return new Promise((resolve) => {
      const req = mod.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: reqPath,
          method,
          headers,
          agent,
          timeout: 20000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
            const rawText = Buffer.concat(chunks).toString('utf8');
            let json = null;
            let validJson = false;
            try {
              json = JSON.parse(rawText);
              validJson = json !== null && typeof json === 'object';
            } catch {
              validJson = false;
            }
            resolve({
              status: res.statusCode || 0,
              durationMs,
              validJson,
              json,
              error: null,
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Request timeout'));
      });

      req.on('error', (err) => {
        const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
        resolve({
          status: 0,
          durationMs,
          validJson: false,
          json: null,
          error: err.message,
        });
      });

      if (payload) req.write(payload);
      req.end();
    });
  };
}

async function runStage({ request, concurrency, regPrefix, totalStudents, fixedExamId }) {
  const latencies = [];
  const statusCounts = { '2xx': 0, '4xx': 0, '5xx': 0, netErr: 0, invalidJson: 0 };
  const sampleErrors = [];

  const cpuBefore = process.cpuUsage();
  const wallStart = Date.now();

  const simulateStudent = async (workerIdx) => {
    // 1.5ms micro-stagger spreads initial TCP SYN handshake across ~750ms while keeping
    // up to 500 virtual students concurrently executing against the backend.
    if (workerIdx > 0) {
      await new Promise((r) => setTimeout(r, workerIdx * 1.5));
    }
    const regNo = `${regPrefix}${String((workerIdx % totalStudents) + 1).padStart(4, '0')}`;

    // 1. Open Student Seat Finder -> GET /api/student/active-exams
    const r1 = await request('GET', '/api/student/active-exams');
    latencies.push(r1.durationMs);
    recordOutcome(r1, statusCounts, sampleErrors);

    const examId = fixedExamId || r1.json?.data?.[0]?._id || undefined;

    // 2. Submit registration number -> POST /api/student/lookup
    const r2 = await request('POST', '/api/student/lookup', {
      registrationNumber: regNo,
      ...(examId ? { examId } : {}),
    });
    latencies.push(r2.durationMs);
    recordOutcome(r2, statusCounts, sampleErrors);

    // 3. Refresh schedule -> GET /api/student/active-exams
    const r3 = await request('GET', '/api/student/active-exams');
    latencies.push(r3.durationMs);
    recordOutcome(r3, statusCounts, sampleErrors);
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => simulateStudent(i)));

  const wallMs = Math.max(1, Date.now() - wallStart);
  const cpuDiff = process.cpuUsage(cpuBefore);
  const totalRequests = latencies.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const sumMs = sorted.reduce((acc, v) => acc + v, 0);
  const mem = process.memoryUsage();
  const health = await request('GET', '/api/health');

  return {
    concurrency,
    totalRequests,
    wallTimeMs: wallMs,
    throughputRps: Number(((totalRequests / wallMs) * 1000).toFixed(1)),
    avgMs: Number((sumMs / totalRequests).toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    p99Ms: Number(percentile(sorted, 99).toFixed(2)),
    maxMs: Number((sorted[sorted.length - 1] || 0).toFixed(2)),
    statusCounts,
    cpuUserMs: Number((cpuDiff.user / 1000).toFixed(1)),
    cpuSystemMs: Number((cpuDiff.system / 1000).toFixed(1)),
    rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
    heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
    poolConfig: health.json?.database?.poolConfig || null,
    sampleErrors: sampleErrors.slice(0, 5),
  };
}

function recordOutcome(res, counts, sampleErrors) {
  if (!res.validJson && res.status !== 0) {
    counts.invalidJson += 1;
  }
  if (res.status === 0) {
    counts.netErr += 1;
    sampleErrors.push(`NET_ERR: ${res.error}`);
  } else if (res.status >= 500) {
    counts['5xx'] += 1;
    sampleErrors.push(`HTTP ${res.status}: ${res.json?.message || 'server error'}`);
  } else if (res.status >= 400) {
    counts['4xx'] += 1;
    if (res.status === 429) {
      sampleErrors.push(`HTTP 429: ${res.json?.message || 'rate limited'}`);
    }
  } else if (res.status >= 200 && res.status < 300) {
    counts['2xx'] += 1;
  }
}

async function seedIsolatedLoadTestData() {
  const mongoose = require('mongoose');
  const Exam = require('../../models/Exam');
  const Allocation = require('../../models/Allocation');
  const Classroom = require('../../models/Classroom');
  const { getTodayKolkataDate, formatTime12h } = require('../../utils/dateTimeUtils');

  const now = new Date();
  const startDt = new Date(now.getTime() + 5 * 60 * 1000); // T+5m -> strictly inside [T-20m, T+10m) OPEN window!
  const endDt = new Date(startDt.getTime() + 3 * 60 * 60 * 1000);
  const pubDt = new Date(startDt.getTime() - 20 * 60 * 1000);
  const { iso } = getTodayKolkataDate(startDt);

  const classroom = await Classroom.create({
    name: 'ET BLOCK 3010 (LoadTest)',
    roomNumber: 'LT3010',
    block: 'ET BLOCK',
    floor: '3rd Floor',
    rows: [],
    totalCapacity: 500,
    availableCapacity: 500,
    isActive: true,
  });

  const students = [];
  const sets = ['A', 'B', 'C'];
  for (let i = 1; i <= 500; i++) {
    const regNo = `24LOAD${String(i).padStart(4, '0')}`;
    const secIdx = Math.min(6, Math.ceil(i / 84));
    students.push({
      registrationNumber: regNo,
      name: `Load Test Student ${i}`,
      seatId: `R${Math.ceil(i / 10)}-B${((i - 1) % 5) + 1}-S${((i - 1) % 2) + 1}`,
      rowNumber: Math.ceil(i / 10),
      benchNumber: ((i - 1) % 5) + 1,
      seatNumber: ((i - 1) % 2) + 1,
      questionPaperSet: sets[(i - 1) % 3],
      group: secIdx <= 3 ? 'Group A' : 'Group B',
      section: `A${secIdx}`,
      classroomName: 'ET BLOCK 3010',
      classroomId: classroom._id,
      facultyName: 'Dr. Load Test Faculty',
      subjectName: 'Scalability & Performance Verification',
      subjectCode: '20A05LT01',
    });
  }

  const exam = await Exam.create({
    examName: 'Isolated 500-Student Load Test Exam',
    academicYear: '2026-2027',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    section: 'A1, A2, A3, A4, A5, A6',
    subjectName: 'Scalability & Performance Verification',
    subjectCode: '20A05LT01',
    examDate: iso,
    startTime: formatTime12h(startDt),
    endTime: formatTime12h(endDt),
    startDateTime: startDt,
    endDateTime: endDt,
    publicationTime: pubDt,
    publicationStatus: 'PUBLISHED',
    publishedAt: pubDt,
    session: startDt.getHours() >= 12 ? 'PM' : 'AM',
    group: 'ALL',
    facultyName: 'Dr. Load Test Faculty',
    classroomId: classroom._id,
    isParentExam: true,
    approvalStatus: 'APPROVED',
    visibilityStatus: 'PUBLISHED',
    allocationStatus: 'GENERATED',
    status: 'PUBLISHED',
    studentCount: students.length,
    isDeleted: false,
    isActive: true,
  });

  const allocation = await Allocation.create({
    examId: exam._id,
    group: 'ALL',
    classroomId: classroom._id,
    version: 1,
    students,
    setDistribution: { A: 167, B: 167, C: 166, total: 500 },
    totalAvailableSeats: 500,
    totalOccupiedSeats: 500,
    validationStatus: { isValid: true, hasAdjacentCollisions: false, violations: [], message: 'OK' },
    randomSeed: `LOADTEST-${Date.now()}`,
    status: 'PUBLISHED',
    isCurrent: true,
  });

  exam.currentAllocationId = allocation._id;
  await exam.save();

  return { examId: String(exam._id), mongoose };
}

async function startIsolatedServerChild() {
  if (process.argv.includes('--server-worker')) {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = process.env.LOADTEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/examseat_loadtest';
    process.env.MONGO_MAX_POOL_SIZE = process.env.MONGO_MAX_POOL_SIZE || '50';
    process.env.MONGO_MIN_POOL_SIZE = process.env.MONGO_MIN_POOL_SIZE || '10';

    const connectDB = require('../../config/db');
    await connectDB();
    const seeded = await seedIsolatedLoadTestData();

    const Exam = require('../../models/Exam');
    const Allocation = require('../../models/Allocation');
    await Promise.all([Exam.syncIndexes(), Allocation.syncIndexes()]);

    const app = require('../../app');
    const server = http.createServer(app);
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', 2048, resolve));
    const { port } = server.address();

    let prevCpu = process.cpuUsage();
    process.on('message', async (msg) => {
      if (msg === 'metrics') {
        const cpu = process.cpuUsage(prevCpu);
        prevCpu = process.cpuUsage();
        const mem = process.memoryUsage();
        process.send({
          type: 'metrics',
          cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
          cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
          rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
          heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        });
      } else if (msg === 'shutdown') {
        await new Promise((resolve) => server.close(resolve));
        try {
          await seeded.mongoose.connection.db.dropDatabase();
        } catch {}
        await seeded.mongoose.connection.close();
        process.exit(0);
      }
    });

    process.send({ type: 'ready', port, examId: seeded.examId });
    return true;
  }
  return false;
}

async function main() {
  if (await startIsolatedServerChild()) {
    return;
  }

  const { isolated, targetUrl, levels } = parseArgs();
  let childProc = null;
  let baseUrl = targetUrl;
  let fixedExamId = null;
  const regPrefix = isolated ? '24LOAD' : '24TEST';

  try {
    if (isolated) {
      childProc = fork(__filename, ['--server-worker'], {
        env: process.env,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });
      const readyMsg = await new Promise((resolve, reject) => {
        childProc.once('message', (msg) => {
          if (msg?.type === 'ready') resolve(msg);
        });
        childProc.once('exit', (code) => reject(new Error(`Server worker exited early with code ${code}`)));
      });
      baseUrl = `http://127.0.0.1:${readyMsg.port}`;
      fixedExamId = readyMsg.examId;
    }

    console.log('========================================================================');
    console.log('  EXAMSEAT AI — STUDENT PORTAL LOAD TEST');
    console.log(`  Mode: ${isolated ? 'ISOLATED LOCAL BENCHMARK (separate server process, examseat_loadtest)' : `TARGET (${baseUrl})`}`);
    console.log(`  Host CPU: ${os.cpus().length} cores (${os.cpus()[0]?.model || 'unknown'})`);
    console.log(`  Concurrency Stages: ${levels.join(', ')} virtual students`);
    console.log('========================================================================\n');

    const request = createRequester(baseUrl);
    // Warm up single request to confirm health before timed stages
    const warmup = await request('GET', '/api/health');
    console.log(`Warmup /api/health -> HTTP ${warmup.status}, db=${warmup.json?.database?.status}, pool=${JSON.stringify(warmup.json?.database?.poolConfig || {})}\n`);

    const results = [];
    for (const concurrency of levels) {
      const stats = await runStage({
        request,
        concurrency,
        regPrefix,
        totalStudents: 500,
        fixedExamId,
      });

      if (childProc) {
        const serverMetrics = await new Promise((resolve) => {
          const handler = (m) => {
            if (m?.type === 'metrics') {
              childProc.off('message', handler);
              resolve(m);
            }
          };
          childProc.on('message', handler);
          childProc.send('metrics');
        });
        stats.serverCpuUserMs = serverMetrics.cpuUserMs;
        stats.serverCpuSystemMs = serverMetrics.cpuSystemMs;
        stats.serverRssMb = serverMetrics.rssMb;
        stats.serverHeapUsedMb = serverMetrics.heapUsedMb;
      }

      results.push(stats);
      console.log(
        `[Stage ${String(concurrency).padStart(3)} users] ` +
          `reqs=${stats.totalRequests} | rps=${stats.throughputRps} | ` +
          `avg=${stats.avgMs}ms | p95=${stats.p95Ms}ms | p99=${stats.p99Ms}ms | ` +
          `2xx=${stats.statusCounts['2xx']} 4xx=${stats.statusCounts['4xx']} 5xx=${stats.statusCounts['5xx']} netErr=${stats.statusCounts.netErr} | ` +
          `srvRss=${stats.serverRssMb ?? stats.rssMb}MB srvHeap=${stats.serverHeapUsedMb ?? stats.heapUsedMb}MB`
      );
      if (stats.sampleErrors.length > 0) {
        console.log('  Sample errors:', stats.sampleErrors);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log('\nJSON_SUMMARY=' + JSON.stringify(results));
  } finally {
    if (childProc && !childProc.killed) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          childProc.kill('SIGKILL');
          resolve();
        }, 5000);
        childProc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        childProc.send('shutdown');
      });
    }
  }
}

main().catch((err) => {
  console.error('[LoadTest Error]', err);
  process.exit(1);
});
