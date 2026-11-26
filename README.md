# ExamSeat AI — Autonomous Academic Examination & Seating Management System

**ExamSeat AI** is a production-grade, unified MERN stack examination seating, question paper set distribution, and attendance management platform built for academic institutions (RGMCET - Department of Computer Science & Engineering).

---

## 🏛 Core Roles & System Architecture

ExamSeat AI operates under four streamlined user roles:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                      EXAMSEAT AI                                       │
├───────────────────────┬────────────────────────┬───────────────────────┬───────────────┤
│         ADMIN         │     EXAM INCHARGE      │        FACULTY        │    STUDENT    │
├───────────────────────┼────────────────────────┼───────────────────────┼───────────────┤
│ • Master Dashboard    │ • Centralized Exam     │ • View assigned       │ • Enter RegNo │
│ • Review Examinations │   Creation (Group A/B) │   subjects & sections │ • View room,  │
│ • Approve & Publish   │ • Section-wise Seating │ • Access section      │   row, chair, │
│ • Section Classrooms  │ • Auto-load permanent  │   attendance sheets   │   set (A/B/C) │
│ • College-branded PDFs│   mappings & rosters   │ • View live rosters   │ • Active T-20 │
└───────────────────────┴────────────────────────┴───────────────────────┴───────────────┘
```

1. **ADMIN**
   - Full control of institutional examination operations.
   - Separate Group A and Group B examination management tabs.
   - Review pending centralized examination allocations.
   - Approve examinations and trigger automated T-20 release schedules.
   - Configure Section-to-Classroom mappings (`GET/PUT /api/classrooms/section-mappings`).
   - Download official college-branded PDFs (Master Allocation, Attendance & Signature, Classroom Seating Charts) and multi-tab Excel reports.

2. **EXAM INCHARGE**
   - Centralized examination creation for an entire academic year and subject:
     1. Academic Year
     2. Semester
     3. Subject & Code
     4. Exam Date
     5. Session (`AM` / `PM`)
     6. Start and End Time
     7. Group A (Sections A1–A3) or Group B (Sections A4–A6)
   - Automatically resolves permanent faculty-student mappings and assigns designated classrooms without repeat uploads.
   - Automatically generates section-wise seating and faculty-specific attendance sheets.

3. **FACULTY**
   - Hierarchical portal: Academic Year -> Semester -> Subject -> Subject Code -> Sections -> Student Roster.
   - Role isolation: faculty members see only their assigned subjects, sections, and rosters.
   - Section-specific attendance sheet PDF downloads with signature tables (clean, zero FDH numbers).

4. **STUDENT**
   - Accessible at `/` or `/student/seat-finder`.
   - Looks up candidate's examination seat by 10-digit College Registration Number.
   - Displays exact: Registration Number, Student Name, Subject, Group (Group A/B), Academic Section (A1–A6), Date, Session (`Morning (AM)` / `Afternoon (PM)`), Classroom Name, Room Number, Row Number, Chair Number, Question Paper Set (A/B/C).
   - Before publication / before T-20: Displays *"Your seating arrangement will be available 20 minutes before the examination."*
   - Never defaults to room 3010; section A2 always sees ET BLOCK 3020.

---

## 🏫 Section-to-Classroom Default Mapping

| Academic Section | Target Group | Assigned Classroom | Standard Capacity |
|:---:|:---:|:---:|:---:|
| **A1** | Group A | **ET BLOCK 3010** | 84 Seats |
| **A2** | Group A | **ET BLOCK 3020** | 84 Seats |
| **A3** | Group A | **ET BLOCK 3030** | 84 Seats |
| **A4** | Group B | **ET BLOCK 3040** | 84 Seats |
| **A5** | Group B | **ET BLOCK 3050** | 84 Seats |
| **A6** | Group B | **ET BLOCK 3060** | 84 Seats |

- Configurable dynamically by Admin via `GET/PUT /api/classrooms/section-mappings`.
- Strict capacity validation: prevents over-capacity allocations without authorized overflow.
- Overlapping booking prevention: detects classroom conflicts across examinations on the same date and time.

---

## 🚀 Quick Start & Development Commands

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas cluster or local MongoDB instance

### 1. Backend Server Setup
```powershell
cd server
npm install
npm start
```
- **Port**: `http://localhost:5000`
- **Database**: MongoDB Atlas (`examseat_ai`)

### 2. Frontend Development Setup
```powershell
cd client
npm install
npm run dev
```
- **Port**: `http://localhost:5173` (proxies `/api` to `http://localhost:5000`)

### 3. Unified Production Build & Start (Local Verification)
```bash
cd server && npm install && cd ../client && npm install && npm run build
```
```bash
npm start --prefix server
```
- Express serves the production React build (`client/dist`) and all `/api/*` endpoints from a single server (`http://localhost:5000`).

### 4. Automated Testing
```powershell
# Unit & Allocation Algorithm Tests (Fisher-Yates, Adjacency, Sets A/B/C)
cd server
npm test

# Comprehensive Checklist & Production Verification Suite
node server/tests/comprehensiveGroupAndRoomTest.js

# MongoDB Atlas Connection Verification
node server/tests/testAtlasConnection.js
```

---

## 🔐 Authentication & Environment Setup

Account credentials and secrets are configured via `server/.env` in development or Render Environment Variables in production (see `.env.example` and `server/.env.example` for template placeholders). Never commit `.env` files or passwords.

| Role | Environment Variable / Account | Access |
|:---|:---|:---|
| **Super Admin** | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Master Dashboard & Settings |
| **Exam Incharge** | `INCHARGE_EMAIL` / `INCHARGE_PASSWORD` | Centralized Exam Scheduling |
| **Faculty** | Provisioned department faculty accounts | Faculty Examination Portal |

---

## 🌐 Production Deployment (Single Render Web Service)

ExamSeat AI runs as a **single unified Render Web Service** using one production URL. Express serves both the `/api/*` REST API and the compiled React SPA from `client/dist`.

### 1. MongoDB Atlas Setup
1. Create a MongoDB Atlas cluster and database user.
2. In **Security -> Network Access**, allow Render's outbound IPs (or `0.0.0.0/0`).
3. Copy your `mongodb+srv://...` connection string for `MONGODB_URI`.

### 2. Render Web Service Configuration (or Blueprint via `render.yaml`)
- **Service Type:** Web Service (`Node`)
- **Root Directory:** *(leave blank / repository root)*
- **Build Command:**
  ```bash
  cd server && npm install && cd ../client && npm install && npm run build
  ```
- **Start Command:**
  ```bash
  npm start --prefix server
  ```
- **Health Check Path:** `/api/health`
- **Environment Variables:**
  - `NODE_ENV=production`
  - `MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/examseat_ai?retryWrites=true&w=majority`
  - `JWT_SECRET=<SECURE_RANDOM_SECRET>`
  - *(Optional initial seed accounts)* `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `INCHARGE_EMAIL`, `INCHARGE_PASSWORD`
  - *(Optional)* `PORT` is automatically assigned by Render (`server/server.js` listens on `process.env.PORT`).

## Vercel deployment (single project with two Services)

This repository uses Vercel Services to deploy the Vite client and Express API from one Git repository and one domain. The root `vercel.json` is the routing source of truth.

### Required Vercel project settings

1. In **Project → Settings → Build and Deployment**, set **Framework Preset** to **Services**. This is required for the top-level `services` configuration in `vercel.json` to be used.
2. Set the project **Root Directory** to the repository root (`./`), not `client/` or `server/`.
3. Ensure the production branch is `main` and that the deployment's source commit is the latest commit containing the `server/app.js` route-bootstrap diagnostics.
4. Add the backend environment variables in Vercel Project Settings → Environment Variables: `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_DEPARTMENT`, `INCHARGE_EMAIL`, and `INCHARGE_PASSWORD`. Use the correct production values; never commit `.env` files.
5. Redeploy after changing the Framework Preset or environment variables.

### Deployment verification

From `server/`, run:

```bash
npm run verify:vercel
npm test
```

The first command verifies that all 12 route modules export valid Express Router functions and that the app mounts the expected API paths. At Vercel cold start, the runtime logs should include `[Route Bootstrap] Mounted ...` for each route. If those messages do not appear, Vercel is not executing the updated `server/app.js` from the expected repository root/commit.

After deployment, check:

- `GET /api/health` — returns the backend and MongoDB health status.
- `POST /api/auth/login` — returns a successful response for valid credentials (or 401 for invalid credentials, not 500).
- `GET /api/student/active-exams` — returns the schedule or a structured database-unavailable response, not a router/bootstrap 500.

Do not use a public unauthenticated database endpoint, disable authentication, or clear MongoDB data as a workaround for route bootstrap errors.
"# Exam_Seat_AI-" 
