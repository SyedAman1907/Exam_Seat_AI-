const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const FacultyMapping = require('../models/FacultyMapping');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas:', mongoose.connection.name);

  // Group mappings by subjectCode + section
  const all = await FacultyMapping.find({}).sort({ version: -1, createdAt: -1 });
  console.log('Total mappings in database:', all.length);

  const seen = new Set();
  let activatedCount = 0;

  for (const m of all) {
    // Ignore test mappings like FSD
    if (m.subjectName === 'FSD' || m.facultyName === 'AMAN') {
      m.isCurrent = false;
      await m.save();
      continue;
    }

    const key = `${m.subjectCode}___${m.section}`;
    if (!seen.has(key)) {
      seen.add(key);
      m.isCurrent = true;
      m.status = 'ACTIVE';
      if (!m.group) {
        m.group = ['A1', 'A2', 'A3'].includes(m.section) ? 'Group A' : 'Group B';
      }
      await m.save();
      activatedCount++;
      console.log(`[Activated] ${m.subjectName} (${m.subjectCode}) Section ${m.section} [${m.group}] Faculty: ${m.facultyName} (v${m.version}, ${m.studentCount} students)`);
    } else {
      m.isCurrent = false;
      await m.save();
    }
  }

  console.log(`\nSuccessfully activated ${activatedCount} unique subject-section mappings as isCurrent=true!`);

  // Verify
  const activeNow = await FacultyMapping.find({ isCurrent: true });
  console.log(`Total isCurrent=true mappings now in database: ${activeNow.length}`);

  await mongoose.disconnect();
}

main().catch(console.error);
