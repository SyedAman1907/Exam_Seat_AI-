import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://exam-seat-ai-1.onrender.com';
const REG_PREFIX = __ENV.REG_PREFIX || '24TEST';
const TOTAL_TEST_STUDENTS = Number(__ENV.TOTAL_TEST_STUDENTS || 500);
const STAGE_VUS = Number(__ENV.STAGE_VUS || 0);
const STAGE_DURATION = __ENV.STAGE_DURATION || '15s';
const MODE = __ENV.MODE || (STAGE_VUS > 0 ? 'fixed_vus' : 'ramp');

const status2xx = new Counter('http_status_2xx');
const status4xx = new Counter('http_status_4xx');
const status5xx = new Counter('http_status_5xx');
const statusTimeout = new Counter('http_status_timeout');

function recordStatus(res) {
  if (!res || res.status === 0) statusTimeout.add(1);
  else if (res.status >= 500) status5xx.add(1);
  else if (res.status >= 400) status4xx.add(1);
  else if (res.status >= 200 && res.status < 300) status2xx.add(1);
}

const commonStats = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

function buildOptions() {
  if (MODE === 'rpm500') {
    return {
      summaryTrendStats: commonStats,
      scenarios: {
        five_hundred_per_min: {
          executor: 'constant-arrival-rate',
          rate: 500,
          timeUnit: '1m',
          duration: __ENV.RPM_DURATION || '20s',
          preAllocatedVUs: 50,
          maxVUs: 250,
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<1500', 'p(99)<3000'],
      },
    };
  }

  if (STAGE_VUS > 0) {
    return {
      summaryTrendStats: commonStats,
      scenarios: {
        sustained_concurrency: {
          executor: 'ramping-vus',
          startVUs: Math.min(25, STAGE_VUS),
          stages: [
            { duration: '2s', target: STAGE_VUS },
            { duration: STAGE_DURATION, target: STAGE_VUS },
          ],
          gracefulRampDown: '2s',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<1500', 'p(99)<3000'],
      },
    };
  }

  return {
    summaryTrendStats: commonStats,
    stages: [
      { duration: '15s', target: 50 },
      { duration: '15s', target: 100 },
      { duration: '15s', target: 250 },
      { duration: '20s', target: 500 },
      { duration: '10s', target: 0 },
    ],
    thresholds: {
      http_req_failed: ['rate<0.02'],
      http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    },
  };
}

export const options = buildOptions();

export default function () {
  // 1. Student opens Student Seat Finder -> fetches active exams
  const activeRes = http.get(`${BASE_URL}/api/student/active-exams`, {
    headers: { Accept: 'application/json' },
  });
  recordStatus(activeRes);
  check(activeRes, {
    'active-exams status 200': (r) => r.status === 200,
    'active-exams valid json': (r) => {
      try {
        const body = r.json();
        return body && body.success === true;
      } catch {
        return false;
      }
    },
  });

  let examId;
  try {
    const body = activeRes.json();
    if (body && Array.isArray(body.data) && body.data.length > 0) {
      examId = body.data[0]._id;
    }
  } catch {}

  if (MODE !== 'rpm500') {
    sleep(0.15);
  }

  // 2. Student submits registration number and retrieves allocated seat
  const idx = ((__VU - 1 + __ITER * 7) % TOTAL_TEST_STUDENTS) + 1;
  const regNo = `${REG_PREFIX}${String(idx).padStart(4, '0')}`;
  const payload = JSON.stringify(examId ? { registrationNumber: regNo, examId } : { registrationNumber: regNo });

  const lookupRes = http.post(`${BASE_URL}/api/student/lookup`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  recordStatus(lookupRes);

  check(lookupRes, {
    'lookup status not 5xx': (r) => r.status < 500,
    'lookup not rate limited': (r) => r.status !== 429,
  });

  if (MODE !== 'rpm500') {
    sleep(0.15);
  }

  // 3. Student refreshes schedule
  const refreshRes = http.get(`${BASE_URL}/api/student/active-exams`, {
    headers: { Accept: 'application/json' },
  });
  recordStatus(refreshRes);
  check(refreshRes, {
    'refresh status 200': (r) => r.status === 200,
  });

  if (MODE !== 'rpm500') {
    sleep(0.25);
  }
}
