const path = require('path');
const dotenv = require('dotenv');

/**
 * Local dev: .env.runtime first, then .env overrides (secrets like EMAIL_* live in .env).
 */
const loadEnv = () => {
  dotenv.config({ path: path.join(process.cwd(), '.env.runtime'), override: true });
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: true });
};

module.exports = { loadEnv };
