# ExamSeat AI — REST API Documentation

Base URL: `http://localhost:5000/api`

## Authentication
- `POST /api/auth/login`: Authenticate faculty (`email`, `password`). Returns JWT token.
- `POST /api/auth/logout`: Invalidate session and audit log logout.
- `GET /api/auth/me`: Get current authenticated user profile.
- `POST /api/auth/forgot-password`: Password reset request.

## Examinations
- `GET /api/exams`: List all examinations with capacity and status.
- `POST /api/exams`: Create examination (prevents duplicate subjectCode, examDate, session, section).
- `GET /api/exams/:id`: Get examination details with populated classroom and allocation.
- `PUT /api/exams/:id`: Update draft examination.
- `DELETE /api/exams/:id`: Remove examination and associated students/allocations.

## Students & Import
- `POST /api/students/import-preview`: Upload file (PDF, XLSX, XLS, CSV) via multipart form data (`file`, `examId`). Returns extracted records and validation flags without saving.
- `POST /api/students/confirm`: Commit confirmed records (`examId`, `students`).
- `GET /api/students/exam/:id`: List all confirmed students for an exam.
- `PUT /api/students/:id`: Update individual student record.
- `DELETE /api/students/:id`: Remove student record.

## Classroom Layout
- `GET /api/classrooms`: List all configured classrooms.
- `GET /api/classrooms/:id`: Get classroom with complete row, bench, and seat hierarchy.
- `POST /api/classrooms`: Create new classroom layout.
- `PUT /api/classrooms/:id`: Update rows, benches, seats, or toggle availability.

## Allocation & Question Paper Sets
- `POST /api/exams/:id/allocate`: Generate randomized seating with Sets A, B, C.
- `POST /api/exams/:id/regenerate`: Generate new allocation version.
- `GET /api/exams/:id/allocation`: Get active allocation for exam.
- `GET /api/exams/:id/allocation/versions`: List past allocation versions.
- `POST /api/exams/:id/verify`: Verify bench adjacency constraints.
- `POST /api/exams/:id/lock`: Lock active allocation.
- `POST /api/exams/:id/publish`: Publish allocation to make it visible in Student Portal.
- `POST /api/exams/:id/unlock`: Unlock allocation with audit trail.

## Official Document Generation
- `GET /api/exams/:id/reports/master-pdf`: Stream PDF 1 (Master Student Allocation).
- `GET /api/exams/:id/reports/signature-pdf`: Stream PDF 2 (Attendance & Signature Sheet).
- `GET /api/exams/:id/reports/seating-pdf`: Stream PDF 3 (Classroom Seating Chart).
- `GET /api/exams/:id/reports/excel`: Stream multi-tab formatted Excel workbook.

## Public Student Portal
- `GET /api/student/active-exams`: List currently published examinations.
- `POST /api/student/lookup`: Search seating by candidate registration number (rate-limited, returns only the candidate's own seating details).
