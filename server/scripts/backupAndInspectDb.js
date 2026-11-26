const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected! Database:', mongoose.connection.name);

    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n--- MongoDB Atlas Collections ---');

    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `atlas_backup_${timestamp}.json`);
    const backupData = {};

    for (const col of collections) {
      const count = await mongoose.connection.db.collection(col.name).countDocuments();
      console.log(`- Collection: ${col.name} (${count} documents)`);
      const docs = await mongoose.connection.db.collection(col.name).find({}).toArray();
      backupData[col.name] = docs;
    }

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
    console.log(`\nFull database backup successfully saved to:\n${backupFile}`);

    console.log('\n--- Inspection of Key Academic Collections ---');
    if (backupData['facultymappings']) {
      console.log(`facultymappings count: ${backupData['facultymappings'].length}`);
      backupData['facultymappings'].slice(0, 10).forEach(m => {
        console.log(`  [Mapping] Subject: ${m.subjectName} (${m.subjectCode}), Section: ${m.section}, Group: ${m.group}, Faculty: ${m.facultyName}, Students: ${m.studentCount || (m.students ? m.students.length : 0)}`);
      });
    }

    if (backupData['subjects']) {
      console.log(`subjects count: ${backupData['subjects'].length}`);
      backupData['subjects'].forEach(s => {
        console.log(`  [Subject] ${s.name || s.subjectName} (${s.code || s.subjectCode})`);
      });
    } else {
      console.log('No "subjects" collection found.');
    }

    if (backupData['classrooms']) {
      console.log(`classrooms count: ${backupData['classrooms'].length}`);
      backupData['classrooms'].forEach(c => {
        console.log(`  [Classroom] ${c.name} (${c.roomNumber}) - Total Cap: ${c.totalCapacity}, Avail Cap: ${c.availableCapacity}`);
      });
    }

    if (backupData['exams']) {
      console.log(`exams count: ${backupData['exams'].length}`);
      backupData['exams'].forEach(e => {
        console.log(`  [Exam] ${e.examName} (${e.subjectCode}), Date: ${e.examDate}, Session: ${e.session}, Group: ${e.group}, Status: ${e.status}, Approval: ${e.approvalStatus}`);
      });
    }

    await mongoose.disconnect();
    console.log('\nDone.');
  } catch (err) {
    console.error('Error during backup/inspection:', err);
    process.exit(1);
  }
}

run();
