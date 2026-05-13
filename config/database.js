const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: '.env.runtime', override: true });

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  `mongodb://127.0.0.1:27017/${process.env.MONGO_DB_NAME || 'lms_database'}`;

const connect = (callback) => {
  mongoose
    .connect(mongoUri, {
      autoIndex: true
    })
    .then(() => callback(null))
    .catch((err) => {
      callback(err);
    });
};

module.exports = {
  mongoose,
  connect
};

