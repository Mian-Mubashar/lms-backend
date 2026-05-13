require('dotenv').config({ path: '.env.runtime', override: true });
const mongoose = require('mongoose');

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  `mongodb://127.0.0.1:27017/${process.env.MONGO_DB_NAME || 'lms_database'}`;

async function test() {
  try {
    console.log('Testing MongoDB connection...');
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('Connected successfully.');
    console.log('Database:', db.databaseName);
    console.log('Collections:', collections.map((c) => c.name).join(', ') || '(none)');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('MongoDB connection FAILED');
    console.error(error.message);
    process.exit(1);
  }
}

test();

