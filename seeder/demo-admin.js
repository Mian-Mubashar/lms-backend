/**
 * Demo admin for local / staging: admin@lms.com / Password123!
 *
 *   npm run db:seed:demo-admin
 *   npm run db:seed:demo-admin -- --reset   # force password + role admin
 */
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { withMongo } = require('./lib/runtime');

const DEMO = {
  email: 'admin@lms.com',
  password: 'Password123!',
  firstName: 'Admin',
  lastName: 'User',
  role: 'admin',
};

const wantsReset = process.argv.includes('--reset');

async function run() {
  const hashed = await bcrypt.hash(DEMO.password, 10);
  const existing = await User.findOne({ email: DEMO.email });

  if (existing && !wantsReset) {
    console.log(`User ${DEMO.email} already exists.`);
    console.log('If login fails with the demo password, run:');
    console.log('  npm run db:seed:demo-admin -- --reset');
    return;
  }

  if (existing && wantsReset) {
    existing.password = hashed;
    existing.role = DEMO.role;
    await existing.save();
    console.log(`Reset password for ${DEMO.email} (role: ${DEMO.role}).`);
  } else {
    await User.create({
      email: DEMO.email,
      password: hashed,
      firstName: DEMO.firstName,
      lastName: DEMO.lastName,
      role: DEMO.role,
    });
    console.log(`Created ${DEMO.email} / ${DEMO.password} (role: ${DEMO.role}).`);
  }

  console.log('Sign in on the login page with those credentials.');
}

withMongo(run).catch((err) => {
  console.error(err);
  process.exit(1);
});
