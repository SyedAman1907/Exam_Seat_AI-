const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';

async function migrate() {
  console.log('Connecting to MongoDB:', MONGO_URI);
  await mongoose.connect(MONGO_URI);

  const db = mongoose.connection.db;
  const examsCollection = db.collection('exams');

  console.log('\n1. Normalizing existing examination records...');
  const exams = await examsCollection.find({}).toArray();
  for (const ex of exams) {
    const isCancelled = ex.status === 'CANCELLED' || ex.approvalStatus === 'CANCELLED';
    const isFailed = ex.status === 'FAILED';
    const isDel = ex.isDeleted === true;
    const active = !(isCancelled || isFailed || isDel);

    await examsCollection.updateOne(
      { _id: ex._id },
      {
        $set: {
          isDeleted: isDel,
          isActive: active,
          academicYear: ex.academicYear || '2026-2027',
          year: ex.year || 'III Year',
          group: ex.group || 'Group A',
          section: (ex.section || 'A1').trim().toUpperCase(),
          subjectCode: (ex.subjectCode || '').trim().toUpperCase(),
        }
      }
    );
  }
  console.log(`Normalized ${exams.length} records.`);

  console.log('\n2. Inspecting and removing obsolete unique indexes...');
  const existingIndexes = await examsCollection.indexes();
  console.log('Current indexes:', existingIndexes.map(i => i.name));

  const obsoleteIndexNames = [
    'subjectCode_1_examDate_1_session_1_section_1',
    'subjectCode_1_examDate_1_session_1_section_1_group_1_year_1'
  ];

  for (const name of obsoleteIndexNames) {
    const found = existingIndexes.find(i => i.name === name);
    if (found) {
      console.log(`Dropping obsolete index: ${name}`);
      await examsCollection.dropIndex(name);
      console.log(`Successfully dropped ${name}.`);
    }
  }

  console.log('\n3. Creating deletion-aware and cancellation-aware partial unique index...');
  await examsCollection.createIndex(
    {
      subjectCode: 1,
      examDate: 1,
      session: 1,
      academicYear: 1,
      year: 1,
      section: 1,
      group: 1,
    },
    {
      unique: true,
      partialFilterExpression: {
        isActive: true,
        isDeleted: false,
      },
      name: 'active_exam_unique_schedule',
      background: true,
    }
  );
  console.log('Successfully created partial unique index "active_exam_unique_schedule".');

  const finalIndexes = await examsCollection.indexes();
  console.log('\nFinal indexes on exams:');
  console.log(JSON.stringify(finalIndexes, null, 2));

  await mongoose.disconnect();
  console.log('\nMigration completed successfully.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
