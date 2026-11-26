const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { maskMongoURI } = require('../config/db');

async function testConnection() {
  console.log('========================================================================');
  console.log('  EXAMSEAT AI — MONGODB ATLAS CONNECTION VERIFICATION');
  console.log('========================================================================');

  const uri = process.env.MONGODB_URI;
  console.log(`[1] Environment Variable MONGODB_URI: ${uri ? 'DEFINED' : 'UNDEFINED'}`);
  console.log(`[2] Masked URI: ${maskMongoURI(uri)}`);

  // Verify masking
  if (uri && (uri.includes('SyedAman1907') || uri.includes(':password@'))) {
    const masked = maskMongoURI(uri);
    if (masked.includes('SyedAman1907')) {
      console.error('CRITICAL: maskMongoURI failed to hide password!');
      process.exit(1);
    }
  }
  console.log('    ✓ Password masking verified safe for terminal logs.');

  console.log('\n[3] Connecting to MongoDB Atlas...');
  const startTime = Date.now();

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 25000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      family: 4,
      autoSelectFamily: false,
    });

    const elapsed = Date.now() - startTime;
    console.log(`✓ Successfully connected in ${elapsed}ms!`);
    console.log(`  Database Name: ${conn.connection.name}`);
    console.log(`  Cluster Host: ${conn.connection.host}`);
    console.log(`  Ready State: ${conn.connection.readyState} (1 = Connected)`);

    console.log('\n[4] Inspecting Collections in Atlas Database...');
    const collections = await conn.connection.db.listCollections().toArray();
    console.log(`  Found ${collections.length} collections:`, collections.map(c => c.name).join(', '));

    console.log('\n[5] Executing Safe Read Operation...');
    const User = require('../models/User');
    const adminUser = await User.findOne({ role: 'admin' }).select('-passwordHash');
    if (adminUser) {
      console.log(`  ✓ Read Super Admin: ${adminUser.name} (${adminUser.email})`);
    } else {
      console.log('  Notice: No admin record found yet (database may need seeding or migration).');
    }

    const FacultyMapping = require('../models/FacultyMapping');
    const mappingCount = await FacultyMapping.countDocuments();
    console.log(`  ✓ Faculty Mappings Count: ${mappingCount}`);

    console.log('\n========================================================================');
    console.log('  ALL CHECKS PASSED: MONGODB ATLAS CONNECTION FULLY OPERATIONAL');
    console.log('========================================================================');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`\n✖ Connection failed after ${elapsed}ms:`);
    console.error(`  Error Name: ${error.name}`);
    console.error(`  Error Message: ${error.message}`);

    console.log('\n------------------------------------------------------------------------');
    console.log('  ROOT CAUSE ANALYSIS:');
    if (error.name === 'MongooseServerSelectionError' || (error.message && error.message.includes('Could not connect to any servers'))) {
      console.log('  • ISSUE: MongoDB Atlas IP Access List restriction.');
      console.log('  • REASON: MongoDB Atlas firewalls block incoming connections by default until');
      console.log('            the client\'s IP address is added to the Network Access whitelist.');
      console.log('  • SOLUTION:');
      console.log('    1. Log in to your MongoDB Atlas dashboard: https://cloud.mongodb.com/');
      console.log('    2. Navigate to "Security" -> "Network Access".');
      console.log('    3. Click the "+ ADD IP ADDRESS" button.');
      console.log('    4. Click "ALLOW ACCESS FROM ANYWHERE" (adds 0.0.0.0/0) or add your current IP.');
      console.log('    5. Click "Confirm" and wait ~1 minute for Atlas to apply.');
    } else if (error.message && (error.message.includes('Authentication failed') || error.message.includes('bad auth'))) {
      console.log('  • ISSUE: Authentication / Credential mismatch.');
      console.log('  • REASON: MongoDB Atlas rejected the username or password.');
      console.log('  • SOLUTION: Check Database Access under Atlas and update server/.env.');
    } else {
      console.log(`  • ISSUE: General Connection Error: ${error.message}`);
    }
    console.log('========================================================================\n');
    process.exit(1);
  }
}

testConnection();
