# ExamSeat AI — System Architecture & Algorithm Design

## 1. System Overview
ExamSeat AI provides an end-to-end automated workflow for engineering colleges to conduct examinations securely and transparently.

```
                    ┌───────────────────────────────┐
                    │      React Frontend (Vite)    │
                    │   - Faculty Admin Portal      │
                    │   - Public Student Seat Finder│
                    └───────────────┬───────────────┘
                                    │ HTTP / JSON
                                    ▼
                    ┌───────────────────────────────┐
                    │      Node.js / Express API    │
                    │   - JWT Auth & Rate Limiting  │
                    │   - File Upload (Multer)      │
                    │   - PDF & Excel Generators    │
                    └───────┬───────────────┬───────┘
                            │               │
                            ▼               ▼
         ┌───────────────────────┐   ┌───────────────────────────────┐
         │ MongoDB Database      │   │ Seating Allocation Engine     │
         │ - Users               │   │ - Fisher-Yates Random Shuffle │
         │ - Exams               │   │ - Balanced CSP Set Allocator  │
         │ - Students            │   │ - Bench Adjacency Validator   │
         │ - Classrooms          │   └───────────────────────────────┘
         │ - Allocations         │
         │ - Audit Logs          │
         └───────────────────────┘
```

## 2. Core Allocation Algorithms

### A. Fisher-Yates Random Shuffling
- Implemented in `server/services/seatingService.js`.
- Shuffles confirmed student array in $O(N)$ time.
- Records pseudo-random seed (`SEED-<timestamp>-<hash>`) for reproducibility, auditing, and verification.

### B. Balanced Question Paper Set Allocation (Sets A, B, C)
- Implemented in `server/services/setAllocationService.js`.
- **Constraint**: On any bench, for adjacent seats $s_i$ and $s_{i+1}$, $\text{Set}(s_i) \neq \text{Set}(s_{i+1})$.
- **Objective**: Equal distribution across sets ($N=72 \Rightarrow \text{Set A}=24, \text{Set B}=24, \text{Set C}=24$).
- **Algorithm**: Constraint Satisfaction Problem (CSP) solver with randomized greedy lookahead based on remaining quota deficit and backtracking fallback.
- **Result**: Guarantees zero adjacent duplicates while strictly matching the 24/24/24 balance for 72 students.

## 3. Allocation Lifecycle State Machine
```
[DRAFT] ──> [STUDENTS_IMPORTED] ──> [ALLOCATED] ──> [VERIFIED] ──> [LOCKED] ──> [PUBLISHED]
                                                                        │             │
                                                                        ▼             ▼
                                                                  Immutable    Visible in
                                                                  Audit Copy   Student Portal
```
- Re-generation is prevented on locked allocations unless explicitly unlocked.
- Each generation records an incremented version number (`v1`, `v2`, etc.).
- Audit logs track all operations with faculty ID, timestamp, and client IP.
