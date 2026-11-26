const mongoose = require('mongoose');

/**
 * Idempotently ensures examination indexes and data consistency on server startup.
 * - Drops legacy obsolete unique indexes that block multi-year, multi-group, or rescheduled exams.
 * - Ensures active_exam_unique_schedule with partialFilterExpression { isActive: true, isDeleted: false }.
 * - Normalizes missing fields (isDeleted, isActive, academicYear, group, year) on historical records.
 */
async function ensureExamIndexes() {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    const examsCollection = db.collection('exams');

    // 1. Normalize existing examination documents
    await examsCollection.updateMany(
      { isDeleted: { $exists: false } },
      { $set: { isDeleted: false } }
    );

    // Mark cancelled or failed examinations as isActive: false
    await examsCollection.updateMany(
      {
        $or: [
          { status: 'CANCELLED' },
          { approvalStatus: 'CANCELLED' },
          { status: 'FAILED' },
          { isDeleted: true },
        ],
      },
      { $set: { isActive: false } }
    );

    // Mark active examinations as isActive: true
    await examsCollection.updateMany(
      {
        status: { $nin: ['CANCELLED', 'FAILED'] },
        approvalStatus: { $ne: 'CANCELLED' },
        isDeleted: { $ne: true },
        isActive: { $exists: false },
      },
      { $set: { isActive: true } }
    );

    // Ensure default academicYear, year, group if missing
    await examsCollection.updateMany(
      { academicYear: { $exists: false } },
      { $set: { academicYear: '2026-2027' } }
    );
    await examsCollection.updateMany(
      { year: { $exists: false } },
      { $set: { year: 'III Year' } }
    );
    await examsCollection.updateMany(
      { group: { $exists: false } },
      { $set: { group: 'Group A' } }
    );

    // 2. Drop obsolete session-wide unique indexes if present (they ignored startTime/endTime)
    const existingIndexes = await examsCollection.indexes();
    const obsoleteIndexes = [
      'subjectCode_1_examDate_1_session_1_section_1',
      'subjectCode_1_examDate_1_session_1_section_1_group_1_year_1',
      'active_exam_unique_schedule',
    ];

    for (const name of obsoleteIndexes) {
      const match = existingIndexes.find((idx) => idx.name === name);
      if (match && (name !== 'active_exam_unique_schedule' || match.unique)) {
        console.log(`[Database Migration] Dropping obsolete unique index: ${name}`);
        try {
          await examsCollection.dropIndex(name);
          console.log(`[Database Migration] Dropped ${name} successfully.`);
        } catch (dropErr) {
          console.warn(`[Database Migration] Could not drop ${name}:`, dropErr.message);
        }
      }
    }

    // 3. Ensure non-unique time-aware lookup index exists (overlap validation runs in application logic)
    const hasLookupIndex = existingIndexes.some((idx) => idx.name === 'exam_schedule_lookup_idx');
    if (!hasLookupIndex) {
      await examsCollection.createIndex(
        {
          subjectCode: 1,
          examDate: 1,
          startTime: 1,
          endTime: 1,
          academicYear: 1,
          year: 1,
          section: 1,
          group: 1,
        },
        {
          name: 'exam_schedule_lookup_idx',
          background: true,
        }
      );
      console.log('[Database Migration] Created time-aware lookup index "exam_schedule_lookup_idx".');
    }
  } catch (err) {
    console.error('[Database Migration Error in ensureExamIndexes]:', err.message);
  }
}

module.exports = ensureExamIndexes;
