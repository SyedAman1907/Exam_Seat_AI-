const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const { maskMongoURI } = require('../config/db');

const LOCAL_URI = process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';
const ATLAS_URI = process.env.MONGODB_URI;

async function migrateData() {
  console.log('========================================================================');
  console.log('  EXAMSEAT AI — DATA MIGRATION: LOCAL MONGODB -> MONGODB ATLAS');
  console.log('========================================================================');
  console.log(`Source (Local): ${LOCAL_URI}`);
  console.log(`Target (Atlas): ${maskMongoURI(ATLAS_URI)}`);

  if (!ATLAS_URI) {
    console.error('Error: MONGODB_URI is not set in server/.env');
    process.exit(1);
  }

  let localClient, atlasClient;
  try {
    console.log('\n[1/4] Connecting to Local MongoDB...');
    localClient = new MongoClient(LOCAL_URI, { serverSelectionTimeoutMS: 5000 });
    await localClient.connect();
    console.log('✓ Connected to Local MongoDB.');

    console.log('\n[2/4] Connecting to MongoDB Atlas...');
    atlasClient = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 10000 });
    await atlasClient.connect();
    console.log('✓ Connected to MongoDB Atlas.');

    const localDb = localClient.db('examseat_ai');
    const atlasDb = atlasClient.db('examseat_ai');

    const collections = await localDb.listCollections().toArray();
    console.log(`\n[3/4] Found ${collections.length} collections in Local Database.`);

    const migrationSummary = [];

    for (const colInfo of collections) {
      const colName = colInfo.name;
      if (colName.startsWith('system.')) continue;

      const localCol = localDb.collection(colName);
      const atlasCol = atlasDb.collection(colName);

      const localCount = await localCol.countDocuments();
      let atlasCountBefore = await atlasCol.countDocuments();

      console.log(`\nProcessing collection: "${colName}" (Local: ${localCount} docs, Atlas Before: ${atlasCountBefore} docs)`);

      if (localCount === 0) {
        console.log(`  Skipping empty collection: ${colName}`);
        migrationSummary.push({ collection: colName, local: 0, atlas: atlasCountBefore, status: 'SKIPPED_EMPTY' });
        continue;
      }

      if (atlasCountBefore >= localCount) {
        console.log(`  Atlas already contains ${atlasCountBefore} documents. Verifying indexes...`);
      } else {
        console.log(`  Migrating ${localCount} documents to Atlas...`);
        const cursor = localCol.find({});
        const batchSize = 500;
        let batch = [];
        let inserted = 0;

        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          batch.push(doc);

          if (batch.length >= batchSize) {
            try {
              const res = await atlasCol.insertMany(batch, { ordered: false });
              inserted += res.insertedCount;
            } catch (bulkErr) {
              // Ignore duplicate key errors on re-run
              if (bulkErr.code === 11000 || bulkErr.writeErrors) {
                inserted += (batch.length - (bulkErr.writeErrors ? bulkErr.writeErrors.length : 0));
              } else {
                console.error(`  Warning in batch insert for ${colName}:`, bulkErr.message);
              }
            }
            batch = [];
          }
        }

        if (batch.length > 0) {
          try {
            const res = await atlasCol.insertMany(batch, { ordered: false });
            inserted += res.insertedCount;
          } catch (bulkErr) {
            if (bulkErr.code === 11000 || bulkErr.writeErrors) {
              inserted += (batch.length - (bulkErr.writeErrors ? bulkErr.writeErrors.length : 0));
            } else {
              console.error(`  Warning in last batch insert for ${colName}:`, bulkErr.message);
            }
          }
        }
        console.log(`  ✓ Inserted/Preserved documents in Atlas: ${inserted}`);
      }

      // Copy indexes (except default _id_)
      try {
        const indexes = await localCol.indexes();
        for (const idx of indexes) {
          if (idx.name === '_id_') continue;
          const { key, name, unique, partialFilterExpression } = idx;
          const options = { name };
          if (unique) options.unique = true;
          if (partialFilterExpression) options.partialFilterExpression = partialFilterExpression;
          try {
            await atlasCol.createIndex(key, options);
          } catch (idxErr) {
            // Index might already exist
          }
        }
      } catch (idxErr) {
        console.warn(`  Index copy notice for ${colName}:`, idxErr.message);
      }

      const atlasCountAfter = await atlasCol.countDocuments();
      migrationSummary.push({
        collection: colName,
        local: localCount,
        atlas: atlasCountAfter,
        status: atlasCountAfter >= localCount ? 'VERIFIED_MATCH' : 'PARTIAL'
      });
    }

    console.log('\n========================================================================');
    console.log('  MIGRATION SUMMARY');
    console.log('========================================================================');
    console.table(migrationSummary);
    console.log('✓ Migration completed successfully.');

  } catch (err) {
    console.error('\n[Migration Error]', err.message);
    if (err.name === 'MongoServerSelectionError' || (err.message && err.message.includes('Could not connect to any servers'))) {
      console.error('\nNOTE: Atlas is currently rejecting incoming connections due to IP whitelist restrictions.');
      console.error('Please whitelist your IP in MongoDB Atlas first, then re-run this migration.');
    }
    process.exit(1);
  } finally {
    if (localClient) await localClient.close();
    if (atlasClient) await atlasClient.close();
  }
}

if (require.main === module) {
  migrateData();
}

module.exports = migrateData;
