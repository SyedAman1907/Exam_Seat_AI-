/**
 * Executes real Grafana k6 load tests (50, 100, 250, 500 VUs + 500 accesses/min)
 * against an isolated local production-mode server (`examseat_loadtest` DB on port 27099).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawnSync } = require('child_process');

const K6_BIN = process.env.K6_BIN || 'C:\\Program Files\\k6\\k6.exe';
const K6_SCRIPT = path.resolve(__dirname, 'student-portal-load.k6.js');
const WORKER_SCRIPT = path.resolve(__dirname, 'runLoadTest.js');

async function main() {
  if (!fs.existsSync(K6_BIN)) {
    throw new Error(`k6 binary not found at ${K6_BIN}`);
  }

  const childProc = fork(WORKER_SCRIPT, ['--server-worker'], {
    env: {
      ...process.env,
      // Allow multi-stage sustained k6 loops over 500 synthetic roll numbers from loopback 127.0.0.1
      // without colliding with production's per-roll (30/min) or per-IP (30k/min) anti-scrape ceilings.
      STUDENT_LOOKUP_PER_ROLL_LIMIT: process.env.STUDENT_LOOKUP_PER_ROLL_LIMIT || '1000',
      STUDENT_PORTAL_BURST_LIMIT: process.env.STUDENT_PORTAL_BURST_LIMIT || '250000',
    },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  try {
    const readyMsg = await new Promise((resolve, reject) => {
      childProc.once('message', (msg) => {
        if (msg?.type === 'ready') resolve(msg);
      });
      childProc.once('exit', (code) => reject(new Error(`Server worker exited early with code ${code}`)));
    });

    const baseUrl = `http://127.0.0.1:${readyMsg.port}`;
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthJson = await healthRes.json();
    console.log(
      `[k6 Suite] Isolated server ready on ${baseUrl} | DB=${healthJson?.database?.status} | pool=${JSON.stringify(
        healthJson?.database?.poolConfig || {}
      )}`
    );

    const stages = [
      { label: '50_VUs', env: { STAGE_VUS: '50', STAGE_DURATION: '10s' } },
      { label: '100_VUs', env: { STAGE_VUS: '100', STAGE_DURATION: '10s' } },
      { label: '250_VUs', env: { STAGE_VUS: '250', STAGE_DURATION: '10s' } },
      { label: '500_VUs', env: { STAGE_VUS: '500', STAGE_DURATION: '15s' } },
      { label: '500_RPM', env: { MODE: 'rpm500', RPM_DURATION: '20s' } },
    ];

    const summaryResults = [];

    for (const stage of stages) {
      const summaryFile = path.join(os.tmpdir(), `k6-${stage.label}-${Date.now()}.json`);
      console.log(`\n[k6 Suite] Running stage: ${stage.label} ...`);

      const k6Run = spawnSync(
        K6_BIN,
        ['run', '--summary-export', summaryFile, K6_SCRIPT],
        {
          env: {
            ...process.env,
            BASE_URL: baseUrl,
            REG_PREFIX: '24LOAD',
            TOTAL_TEST_STUDENTS: '500',
            ...stage.env,
          },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      if (k6Run.status !== 0) {
        console.error(k6Run.stdout || '');
        console.error(k6Run.stderr || '');
        throw new Error(`k6 stage ${stage.label} failed with exit code ${k6Run.status}`);
      }

      const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
      try { fs.unlinkSync(summaryFile); } catch {}

      const metrics = summary.metrics || {};
      const srvMetrics = await new Promise((resolve) => {
        const handler = (m) => {
          if (m?.type === 'metrics') {
            childProc.off('message', handler);
            resolve(m);
          }
        };
        childProc.on('message', handler);
        childProc.send('metrics');
      });

      const dur = metrics.http_req_duration || {};
      const reqs = metrics.http_reqs || {};
      const failed = metrics.http_req_failed || {};
      const s2 = metrics.http_status_2xx?.count || 0;
      const s4 = metrics.http_status_4xx?.count || 0;
      const s5 = metrics.http_status_5xx?.count || 0;
      const sTo = metrics.http_status_timeout?.count || 0;

      const row = {
        stage: stage.label,
        totalRequests: reqs.count || 0,
        rps: Number((reqs.rate || 0).toFixed(2)),
        avgMs: Number((dur.avg || 0).toFixed(2)),
        p95Ms: Number((dur['p(95)'] || 0).toFixed(2)),
        p99Ms: Number((dur['p(99)'] || 0).toFixed(2)),
        maxMs: Number((dur.max || 0).toFixed(2)),
        http2xx: s2,
        http4xx: s4,
        http5xx: s5,
        timeouts: sTo,
        failRatePct: Number(((failed.value || 0) * 100).toFixed(3)),
        serverCpuUserMs: srvMetrics.cpuUserMs,
        serverCpuSystemMs: srvMetrics.cpuSystemMs,
        serverRssMb: srvMetrics.rssMb,
        serverHeapUsedMb: srvMetrics.heapUsedMb,
      };
      summaryResults.push(row);
      console.log(
        `[k6 ${row.stage}] reqs=${row.totalRequests} | rps=${row.rps} | avg=${row.avgMs}ms | p95=${row.p95Ms}ms | p99=${row.p99Ms}ms | 2xx=${row.http2xx} 4xx=${row.http4xx} 5xx=${row.http5xx} to=${row.timeouts} | rss=${row.serverRssMb}MB heap=${row.serverHeapUsedMb}MB`
      );
    }

    console.log('\nK6_RESULTS_JSON=' + JSON.stringify(summaryResults));
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
  console.error('[k6 Suite Error]', err);
  process.exit(1);
});
