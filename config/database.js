const dns = require('dns');
// ISP DNS often refuses Node SRV lookups (querySrv ECONNREFUSED) for mongodb+srv://.
// Set this before mongoose loads so the first Atlas connect uses public DNS.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: '.env.runtime', override: false });
dotenv.config({ path: '.env', override: true });

const isCloudHost =
  Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';

const looksLikeLocalMongo = (uri) => {
  const u = String(uri).toLowerCase();
  return (
    u.includes('127.0.0.1') ||
    u.includes('localhost') ||
    u.startsWith('mongodb://0.0.0.0')
  );
};

/** Resolved Atlas/remote URI, or null on Vercel/production when unset (never localhost there). */
const getMongoUri = () => {
  const explicit = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (explicit) {
    if (isCloudHost && looksLikeLocalMongo(explicit)) {
      return null;
    }
    return explicit;
  }
  if (isCloudHost) return null;
  return `mongodb://127.0.0.1:27017/${process.env.MONGO_DB_NAME || 'lms_database'}`;
};

const connect = (callback) => {
  const uri = getMongoUri();
  if (!uri) {
    const hadLocal =
      isCloudHost &&
      looksLikeLocalMongo(
        (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim()
      );
    return callback(
      new Error(
        hadLocal
          ? 'MONGODB_URI/MONGO_URI points to localhost — remove it on Vercel or replace with your Atlas mongodb+srv://... string (Production + Preview envs), then redeploy.'
          : 'Missing MONGODB_URI (or MONGO_URI). In Vercel: Project → Settings → Environment Variables → add your MongoDB Atlas connection string, then redeploy. Localhost MongoDB is not available on serverless.'
      )
    );
  }
  const options = { autoIndex: true };
  mongoose
    .connect(uri, options)
    .then(() => callback(null))
    .catch((err) => {
      const srvRefused = err && err.code === 'ECONNREFUSED' && err.syscall === 'querySrv';
      if (!srvRefused) return callback(err);
      dns.setServers(['1.1.1.1', '8.8.8.8']);
      mongoose.connect(uri, options).then(() => callback(null)).catch(callback);
    });
};

module.exports = {
  mongoose,
  connect,
  getMongoUri
};

