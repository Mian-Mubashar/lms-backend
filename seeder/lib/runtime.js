/**
 * Shared env + Mongo wiring for CLI seeders / one-off imports.
 * Always run via `npm run …` from the `backend` folder so `process.cwd()` is correct.
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), '.env.runtime'), override: true });
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false });
}

function getMongoUri() {
  loadEnv();
  return (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    `mongodb://127.0.0.1:27017/${process.env.MONGO_DB_NAME || 'lms_database'}`
  );
}

/** Runs `fn` while connected to Mongo, then disconnects. */
async function withMongo(fn) {
  loadEnv();
  await mongoose.connect(getMongoUri());
  try {
    await fn();
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { loadEnv, getMongoUri, withMongo };
