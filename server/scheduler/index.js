const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const AuditLog = require('../models/AuditLog');
const { isDbConnectivityError } = require('../config/db');
const { parseKolkataDateTime, parseExamDateRange, formatExamTimeRange } = require('../utils/dateTimeUtils');

/**
 * Persistent Background Publication & Lifecycle Scheduler
 *
 * Periodically checks for:
 * 1. Concluded examinations whose end time has passed, automatically marking
 *    them and all associated allocations/sections as COMPLETED.
 * 2. Approved examinations due for scheduled publication.
 *
 * Resilient against temporary MongoDB Atlas / DNS disconnections:
 * - Pauses database-dependent jobs when readyState !== 1
 * - Prevents overlapping cycles
 * - Avoids terminal log flooding on persistent outages
 * - Automatically resumes upon MongoDB reconnection
 */
class PublicationScheduler {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.isCycleRunning = false;
    this.isPausedDueToDb = false;
    this.lastDbErrorLogAt = 0;
    this.lastCompletionCheckAt = 0;
    this.activeCompletionPromise = null;
    this.checkIntervalMs = 10000; // 10 seconds
  }

  /**
   * Checks whether MongoDB is connected; logs pause/resume transitions without spamming.
   */
  ensureDbReady(contextLabel = 'Scheduler') {
    if (mongoose.connection.readyState === 1) {
      if (this.isPausedDueToDb) {
        this.isPausedDueToDb = false;
        this.lastDbErrorLogAt = 0;
        console.log(`[${contextLabel}] MongoDB connection restored. Resuming background checks.`);
      }
      return true;
    }

    if (!this.isPausedDueToDb) {
      this.isPausedDueToDb = true;
      console.warn(`[${contextLabel}] MongoDB disconnected. Pausing database checks until Atlas reconnects.`);
    }
    return false;
  }

  logSchedulerError(label, err) {
    const nowMs = Date.now();
    if (isDbConnectivityError(err) || mongoose.connection.readyState !== 1) {
      if (nowMs - this.lastDbErrorLogAt > 60000) {
        this.lastDbErrorLogAt = nowMs;
        console.warn(`[Scheduler] Database unreachable during ${label}; will retry once reconnected (${err.message}).`);
      }
      return;
    }
    console.error(`[Scheduler Error] Error during ${label}:`, err.message);
  }

  /**
   * Start the scheduler loop
   */
  start(options = {}) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Scheduler] Background Publication and Completion Scheduler initialized.');

    // 1. Immediately process overdue completions and scheduled publications on server boot
    if (options.runImmediate !== false) {
      this.activeCyclePromise = this.checkScheduledPublications().finally(() => {
        this.activeCyclePromise = null;
      });
    }

    // 2. Run periodic checks (non-overlapping)
    this.intervalId = setInterval(() => {
      this.checkScheduledPublications();
    }, this.checkIntervalMs);
    if (this.intervalId.unref) {
      this.intervalId.unref();
    }
  }

  /**
   * Stop the scheduler loop
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[Scheduler] Background Scheduler stopped.');
  }

  /**
   * Invoked automatically when MongoDB reconnects after an outage
   */
  async onDatabaseReconnect() {
    if (!this.isRunning) return;
    this.isPausedDueToDb = false;
    this.lastDbErrorLogAt = 0;
    this.lastCompletionCheckAt = 0;
    console.log('[Scheduler] MongoDB reconnected. Triggering recovery verification cycle...');
    await this.checkScheduledPublications();
  }

  /**
   * Synchronizes exam lifecycle states:
   * - Transitions approved/published/ongoing exams into ONGOING during [startDateTime, endDateTime)
   * - Automatically marks approved/published/ongoing examinations as COMPLETED once their scheduled end time is reached.
   * Does NOT prematurely complete unreviewed DRAFT or PENDING_REVIEW exams so they remain visible for Admin review.
   * Updates parent examinations, child section allocations, and associated Allocation documents atomically.
   * Preserves all examination records, student allocations, and reports in MongoDB.
   * @param {Date|null} [overrideNow] - Optional reference date for testing
   * @returns {Promise<number>} Number of examinations transitioned to COMPLETED
   */
  async completeOverdueExams(overrideNow = null) {
    if (!this.ensureDbReady('Scheduler')) return 0;

    // Coalesce concurrent checks and avoid redundant scans within 10s during normal operation
    if (!overrideNow) {
      if (this.activeCompletionPromise) {
        return this.activeCompletionPromise;
      }
      if (Date.now() - this.lastCompletionCheckAt < 10000) {
        return 0;
      }
    }

    const executeSweep = async () => {
      try {
        const now = overrideNow || new Date();

        const activeExams = await Exam.find({
          isDeleted: { $ne: true },
          status: { $nin: ['COMPLETED', 'CANCELLED', 'DRAFT'] },
          approvalStatus: { $nin: ['CANCELLED', 'REJECTED', 'DRAFT', 'PENDING_REVIEW'] },
        })
          .select('examName subjectCode examDate startTime endTime startDateTime endDateTime allowOvernight status')
          .lean();

        if (!activeExams || activeExams.length === 0) {
          if (!overrideNow) this.lastCompletionCheckAt = Date.now();
          return 0;
        }

        let completedCount = 0;

        for (const exam of activeExams) {
          let startDateTime = null;
          let endDateTime = null;
          if (exam.examDate && exam.startTime && exam.endTime) {
            try {
              const storedOvernight =
                Boolean(exam.allowOvernight) ||
                Boolean(
                  exam.startDateTime &&
                    exam.endDateTime &&
                    new Date(exam.endDateTime).getTime() > new Date(exam.startDateTime).getTime() &&
                    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(exam.endDateTime)) >
                      exam.examDate
                );
              const range = parseExamDateRange(exam.examDate, exam.startTime, exam.endTime, null, {
                allowOvernight: storedOvernight,
              });
              startDateTime = range.startDateTime;
              endDateTime = range.endDateTime;
            } catch (e) {}
          }
          if (!startDateTime && exam.examDate && exam.startTime) {
            try {
              startDateTime = parseKolkataDateTime(exam.examDate, exam.startTime);
            } catch (e) {}
          }
          if (!startDateTime && exam.startDateTime) {
            startDateTime = new Date(exam.startDateTime);
          }

          if (!endDateTime && exam.examDate && exam.endTime) {
            try {
              endDateTime = parseKolkataDateTime(exam.examDate, exam.endTime);
            } catch (e) {}
          }
          if (!endDateTime && exam.endDateTime) {
            endDateTime = new Date(exam.endDateTime);
          }

          // Transition PUBLISHED -> ONGOING during active exam window [startDateTime, endDateTime)
          if (
            startDateTime &&
            endDateTime &&
            now >= startDateTime &&
            now < endDateTime &&
            exam.status === 'PUBLISHED'
          ) {
            await Exam.updateOne(
              { _id: exam._id, status: 'PUBLISHED' },
              { $set: { status: 'ONGOING', updatedAt: new Date() } }
            );
            continue;
          }

          // Atomically transition to COMPLETED when scheduled end time has arrived (prevents duplicate completions)
          if (endDateTime && now >= endDateTime) {
            const updateOps = {
              $set: {
                status: 'COMPLETED',
                visibilityStatus: 'EXPIRED',
                completedAt: now,
                updatedAt: now,
              },
            };

            const transitioned = await Exam.findOneAndUpdate(
              { _id: exam._id, status: { $ne: 'COMPLETED' } },
              updateOps,
              { new: true }
            );

            if (transitioned && Array.isArray(transitioned.sectionAllocations) && transitioned.sectionAllocations.length > 0) {
              await Exam.updateOne(
                { _id: exam._id },
                { $set: { 'sectionAllocations.$[].allocationStatus': 'COMPLETED' } }
              );
            }

            if (!transitioned) {
              continue; // Already transitioned by another worker/request
            }

            await Allocation.updateMany(
              { examId: exam._id },
              {
                $set: {
                  status: 'COMPLETED',
                  completedAt: now,
                  'sectionSummaries.$[].status': 'COMPLETED',
                },
              }
            );

            try {
              await AuditLog.create({
                action: 'EXAM_COMPLETED',
                performedByName: 'AUTOMATIC_SCHEDULER',
                examId: exam._id,
                details: {
                  examName: exam.examName,
                  subjectCode: exam.subjectCode,
                  scheduledEnd: endDateTime,
                  completedAt: now,
                  reason: 'Scheduled examination end time reached',
                },
              });
            } catch (logErr) {}

            completedCount++;
            console.log(
              `[Scheduler] Automatically transitioned Examination "${exam.examName} (${exam.subjectCode})" (ID: ${exam._id}) to COMPLETED.`
            );
          }
        }

        if (!overrideNow) this.lastCompletionCheckAt = Date.now();
        return completedCount;
      } catch (err) {
        this.logSchedulerError('overdue examination completion sweep', err);
        return 0;
      }
    };

    if (overrideNow) {
      return executeSweep();
    }

    this.activeCompletionPromise = executeSweep().finally(() => {
      this.activeCompletionPromise = null;
    });
    return this.activeCompletionPromise;
  }

  /**
   * Core check loop: Completes overdue exams and releases scheduled publications
   */
  async checkScheduledPublications(overrideNow = null) {
    if (!this.ensureDbReady('Scheduler')) return 0;

    if (this.isCycleRunning && !overrideNow) {
      return 0; // Prevent overlapping execution cycles
    }

    this.isCycleRunning = true;
    try {
      const now = overrideNow || new Date();

      // 1. First, complete any exams whose scheduled end time has arrived
      await this.completeOverdueExams(overrideNow);

      if (mongoose.connection.readyState !== 1) return 0;

      // 2. Find all approved exams scheduled for publication that haven't ended yet
      const pendingExams = await Exam.find({
        isDeleted: { $ne: true },
        status: { $nin: ['FAILED', 'COMPLETED', 'CANCELLED', 'ONGOING', 'PUBLISHED'] },
        allocationStatus: { $ne: 'FAILED' },
        approvalStatus: { $nin: ['CANCELLED', 'REJECTED', 'DRAFT'] },
        $or: [
          {
            approvalStatus: 'APPROVED',
            visibilityStatus: 'SCHEDULED',
            publicationTime: { $lte: now },
          },
          {
            status: { $in: ['SCHEDULED', 'GENERATED', 'ALLOCATED', 'VERIFIED'] },
            visibilityStatus: { $ne: 'PUBLISHED' },
            publicationTime: { $lte: now },
          },
        ],
      })
        .select('_id examDate endTime endDateTime')
        .lean();

      if (!pendingExams || pendingExams.length === 0) return 0;

      console.log(`[Scheduler] Found ${pendingExams.length} examination(s) due for scheduled publication.`);

      for (const exam of pendingExams) {
        if (mongoose.connection.readyState !== 1) break;
        let endDateTime = exam.endDateTime ? new Date(exam.endDateTime) : null;
        if (!endDateTime && exam.examDate && exam.endTime) {
          try {
            endDateTime = parseKolkataDateTime(exam.examDate, exam.endTime);
          } catch (e) {}
        }
        if (!endDateTime || now < endDateTime) {
          await this.publishExamSafely(exam._id, 'AUTOMATIC_SCHEDULER');
        }
      }

      return pendingExams.length;
    } catch (err) {
      this.logSchedulerError('publication check cycle', err);
      return 0;
    } finally {
      this.isCycleRunning = false;
    }
  }

  /**
   * Safely and idempotently publishes an examination allocation
   */
  async publishExamSafely(examId, triggeredBy = 'MANUAL') {
    if (!this.ensureDbReady('Scheduler')) {
      return { success: false, message: 'Database unavailable while publishing.' };
    }

    try {
      const exam = await Exam.findById(examId);
      if (!exam) {
        return { success: false, message: 'Examination not found.' };
      }

      // Prevent publication of cancelled examinations
      if (exam.approvalStatus === 'CANCELLED' || exam.status === 'CANCELLED') {
        return { success: false, message: 'Cannot publish cancelled examination.' };
      }

      // If already published/ongoing, return idempotent success
      if (exam.visibilityStatus === 'PUBLISHED' || exam.status === 'PUBLISHED' || exam.status === 'ONGOING') {
        return { success: true, message: 'Examination is already published.', exam };
      }

      // Validate allocation existence
      let allocation = null;
      if (exam.currentAllocationId) {
        allocation = await Allocation.findById(exam.currentAllocationId);
      }
      if (!allocation) {
        allocation = await Allocation.findOne({ examId: exam._id }).sort({ createdAt: -1 });
      }

      if (!allocation || !allocation.students || allocation.students.length === 0) {
        console.warn(
          `[Scheduler] Exam ${exam._id} (${exam.examName}) has no allocation generated or 0 students. Marking FAILED.`
        );
        exam.allocationStatus = 'FAILED';
        exam.status = 'FAILED';
        exam.publicationStatus = 'FAILED';
        exam.visibilityStatus = 'NOT_SCHEDULED';
        exam.lastError = 'Cannot publish: Seating allocation has not been generated or contains 0 students.';
        await exam.save();
        return { success: false, message: exam.lastError };
      }

      const now = new Date();

      // Atomic update on Exam
      const updatedExam = await Exam.findOneAndUpdate(
        {
          _id: exam._id,
          $or: [
            { approvalStatus: 'APPROVED', visibilityStatus: 'SCHEDULED' },
            { status: { $in: ['SCHEDULED', 'GENERATED', 'ALLOCATED', 'VERIFIED', 'FAILED'] } },
          ],
          approvalStatus: { $ne: 'CANCELLED' },
          status: { $nin: ['PUBLISHED', 'ONGOING', 'COMPLETED', 'CANCELLED'] },
        },
        {
          $set: {
            approvalStatus: 'APPROVED',
            visibilityStatus: 'PUBLISHED',
            status: 'PUBLISHED',
            publishedAt: now,
            lastError: '',
          },
        },
        { new: true }
      );

      if (!updatedExam) {
        return { success: false, message: 'Exam was already modified or published concurrently.' };
      }

      await Allocation.updateMany(
        { examId: exam._id },
        { $set: { status: 'PUBLISHED', publishedAt: now } }
      );

      await AuditLog.create({
        action: 'EXAM_PUBLISHED',
        performedByName: triggeredBy,
        examId: exam._id,
        allocationVersion: allocation.version,
        details: {
          examName: exam.examName,
          subjectName: exam.subjectName,
          section: exam.section,
          publishedAt: now,
          studentCount: allocation.students.length,
          triggeredBy,
        },
      });

      console.log(
        `[Scheduler] Successfully PUBLISHED Exam "${exam.examName} - ${exam.subjectName}" (ID: ${exam._id}) with ${allocation.students.length} students at ${now.toISOString()}`
      );

      return {
        success: true,
        message: 'Examination seating allocation successfully published.',
        exam: updatedExam,
        allocation,
      };
    } catch (err) {
      this.logSchedulerError(`publish exam ${examId}`, err);
      return { success: false, message: err.message };
    }
  }

  /**
   * Recovers and re-verifies scheduled jobs from MongoDB
   */
  async recoverScheduledJobs() {
    if (!this.ensureDbReady('Scheduler')) return 0;
    const scheduled = await Exam.find({
      $or: [
        { approvalStatus: 'APPROVED', visibilityStatus: 'SCHEDULED' },
        { status: 'SCHEDULED' },
      ],
    })
      .select('_id')
      .lean();
    await this.checkScheduledPublications();
    return scheduled.length;
  }
}

module.exports = new PublicationScheduler();
