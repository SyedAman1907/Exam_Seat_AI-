# ExamSeat AI — Autonomous Academic Examination & Seating Management System

**ExamSeat AI** is a production-grade MERN stack examination scheduling, permanent mapping, seating allocation, question paper set distribution, and attendance management platform built for RGMCET (Department of Computer Science & Engineering, `Asia/Kolkata` timezone).

---

## 🏛 Core Roles & System Architecture

ExamSeat AI operates strictly under **three streamlined roles** (`ADMIN`, `FACULTY`, `STUDENT`):

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                 EXAMSEAT AI                                │
├────────────────────────────┬───────────────────────────┬───────────────────┤
│           ADMIN            │          FACULTY          │      STUDENT      │
├────────────────────────────┼───────────────────────────┼───────────────────┤
│ • Master Dashboard         │ • View OWN assigned       │ • Sign in via     │
│ • Faculty & Subject CRUD   │   subjects & sections     │   Reg. Number     │
│ • PDF / Excel / CSV        │ • Request Examination     │ • View personal   │
│   Permanent Mappings       │   (UNIT 1 – UNIT 5)       │   exam schedule   │
│ • Approve / Reject /       │ • Set custom Student      │ • Countdown until │
│   Publish / Cancel Exams   │   Portal Publication Time │   Publication Time│
│ • Classroom & Section Map  │ • View own section        │ • View ONLY own   │
│ • PDF / ZIP / Excel Reports│   attendance & rosters    │   hall/row/bench/ │
│                            │                           │   chair/Set A/B/C │
└────────────────────────────┴───────────────────────────┴───────────────────┘
```

> **Note:** The legacy `Exam Incharge` role has been completely removed.

1. **ADMIN (`admin`)**
   - Full system administration: `Dashboard`, `Faculty Management`, `Subject Management`, `Permanent Student Mapping`, `Examination Requests & Scheduling`, `Classroom Management`, `Seating Allocation`, `Student Management`, `Attendance & Examination Reports`, and `System Settings`.
   - Uploads multi-format permanent nominal rosters (**PDF**, **Excel `.xlsx`/`.xls`**, **CSV**) with automatic **inconsistent student name detection** across files/sections before saving.
   - Reviews faculty-scheduled `UNIT 1`–`UNIT 5` examinations, approves seating allocations, triggers scheduled/immediate publication to the Student Portal, and exports college-branded PDFs/ZIPs/Excel workbooks.

2. **FACULTY (`faculty`)**
   - Hierarchical workspace scoped strictly to the faculty member's own permanently mapped subjects and sections:
     `Academic Year -> Semester -> Subject -> Subject Code -> Assigned Sections -> Enrolled Students`.
   - Creates examination schedule requests (`UNIT 1` through `UNIT 5`) using digital 12-hour `Asia/Kolkata` start/end times and mandatory **Student Portal Publication Time** (`< startDateTime`).
   - Isolated from viewing other faculty rosters or creating/modifying permanent mappings.

3. **STUDENT (`student`)**
   - Signs in via Registration Number (`POST /api/auth/student-login`) at `/` or `/student/login` or `/student/seat-finder`.
   - Views personal scheduled examinations via `GET /api/student/my-exams`.
   - Before configured **Publication Time**: displays live countdown and `"Your seating arrangement will be available at <time>."`
   - From **Publication Time** through **10 minutes after exam start (`T+10`)**: displays **only that student's own** Classroom, Room Number, Row, Bench, Chair/Seat, Question Paper Set (`A`/`B`/`C`), and exam instructions. Zero access to other students' seats or full rosters.

---

## 🏫 Section-to-Classroom Default Mapping

| Academic Section | Target Group | Assigned Classroom | Standard Capacity |
|:---:|:---:|:---:|:---:|
| **A1** | Group A | **ET BLOCK 3010** | 72–84 Seats |
| **A2** | Group A | **ET BLOCK 3020** | 72–84 Seats |
| **A3** | Group A | **ET BLOCK 3030** | 72–84 Seats |
| **A4** | Group B | **ET BLOCK 3040** | 72–84 Seats |
| **A5** | Group B | **ET BLOCK 3050** | 72–84 Seats |
| **A6** | Group B | **ET BLOCK 3060** | 72–84 Seats |

- Configurable by Admin via `/api/classrooms/section-mappings`.
- Strict classroom overlap & capacity verification enforced in `Asia/Kolkata`.

---

## 🗄 Safeguarded One-Time Database Backup & Reset

To safely clean legacy academic records (while preserving Admin accounts and active ET BLOCK classrooms):

```bash
# Requires explicit confirmation flag; writes timestamped JSON snapshot to server/backups/ first
node server/scripts/resetAcademicData.js --confirm-reset
```

---

## 🚀 Quick Start & Automated Testing

### Backend & Frontend Setup
```powershell
cd server && npm install && npm start
cd client && npm install && npm run dev
```

### Verification Suites
```powershell
# Allocation algorithm unit tests
npm test --prefix server

# CORS & Vercel route bootstrap diagnostics
node server/tests/verifyCors.js
npm run verify:vercel --prefix server

# Isolated E2E, Mapping Jobs, Timezone & Load Suites (uses local mongod, never production Atlas)
node server/tests/verifyMappingJobsAndTime.js
node server/tests/verifyCentralizedWorkflowE2E.js
node server/tests/load/runK6Suite.js
```

---

## 🔐 Environment Variables

Configure via `server/.env` (development) or Render / Vercel Environment Variables (production):
- `MONGODB_URI`, `JWT_SECRET`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_DEPARTMENT`
- `CORS_ALLOWED_ORIGINS` (Vercel production & preview URLs)
