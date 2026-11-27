import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://exam-seat-ai-1.onrender.com';
const REG_PREFIX = __ENV.REG_PREFIX || '24TEST';
const TOTAL_TEST_STUDENTS = Number(__ENV.TOTAL_TEST_STUDENTS || 500);

export const options = {
  stages: [
    { duration: '20s', target: 50 },
    { duration: '25s', target: 100 },
    { duration: '25s', target: 250 },
    { duration: '30s', target: 500 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

export default function () {
  // 1. Student opens Student Seat Finder -> fetches active exams
  const activeRes = http.get(`${BASE_URL}/api/student/active-exams`, {
    headers: { Accept: 'application/json' },
  });
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

  sleep(0.2);

  // 2. Student submits registration number and retrieves allocated seat
  const idx = ((__VU - 1) % TOTAL_TEST_STUDENTS) + 1;
  const regNo = `${REG_PREFIX}${String(idx).padStart(4, '0')}`;
  const payload = JSON.stringify(examId ? { registrationNumber: regNo, examId } : { registrationNumber: regNo });

  const lookupRes = http.post(`${BASE_URL}/api/student/lookup`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  check(lookupRes, {
    'lookup status not 5xx': (r) => r.status < 500,
    'lookup not rate limited': (r) => r.status !== 429,
  });

  sleep(0.2);

  // 3. Student refreshes schedule
  const refreshRes = http.get(`${BASE_URL}/api/student/active-exams`, {
    headers: { Accept: 'application/json' },
  });
  check(refreshRes, {
    'refresh status 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
