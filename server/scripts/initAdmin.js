require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const initAdmin = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';
      await mongoose.connect(mongoUri);
      console.log('[Admin Init] Connected to MongoDB');
    }

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@rgmcet.edu.in').toLowerCase().trim();
    const adminUsername = 'admin';

    // Check if Super Admin already exists
    let admin = await User.findOne({
      $or: [
        { email: adminEmail },
        { username: adminUsername },
        { role: 'admin' },
      ],
    });

    if (admin) {
      // Ensure username field is set without touching existing password hash
      let updated = false;
      if (!admin.username) {
        admin.username = adminUsername;
        updated = true;
      }
      if (!admin.isActive) {
        admin.isActive = true;
        updated = true;
      }
      if (updated) {
        await admin.save();
      }

      console.log(`[Admin Init] Super Admin account already exists: ${admin.email} (${admin.username || 'admin'}).`);
      console.log('[Admin Init] Existing credentials and password hash safely preserved (not overwritten).');
    } else {
      const password = process.env.ADMIN_PASSWORD || 'AdminExam@2026';
      const passwordHash = await User.hashPassword(password);

      admin = await User.create({
        name: process.env.ADMIN_NAME || 'Exam Controller Admin',
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        role: 'admin',
        department: process.env.ADMIN_DEPARTMENT || 'Computer Science and Engineering',
        designation: 'Chief Superintendent & Exam Controller',
        isActive: true,
      });

      console.log(`[Admin Init] Super Admin account initialized successfully: ${admin.email}`);
      console.log(`[Admin Init] Role: ${admin.role} | Department: ${admin.department}`);
    }

    await mongoose.disconnect();
    console.log('[Admin Init] Done. Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('[Admin Init Error]', error.message);
    process.exit(1);
  }
};

initAdmin();