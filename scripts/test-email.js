const { loadEnv } = require('../lib/loadEnv');
const { isEmailConfigured, sendPasswordResetEmail, getEmailConfig } = require('../lib/email');

loadEnv();

const to = process.argv[2];

(async () => {
  const config = getEmailConfig();
  console.log('EMAIL_HOST:', config.host);
  console.log('EMAIL_USER:', config.user || '(empty)');
  console.log('EMAIL_PASS:', config.pass ? '***set***' : '(empty)');

  if (!isEmailConfigured()) {
    console.error('\nEmail is not configured.');
    console.error('Add EMAIL_USER and EMAIL_PASS to backend/.env (Gmail App Password), then restart nodemon.');
    process.exit(1);
  }

  const target = to || config.user;
  if (!target) {
    console.error('\nUsage: node scripts/test-email.js [recipient@email.com]');
    process.exit(1);
  }

  try {
    await sendPasswordResetEmail({
      to: target,
      resetCode: '123456',
      firstName: 'Test'
    });
    console.log(`\nTest email sent to ${target}`);
  } catch (error) {
    console.error('\nFailed to send test email:', error.message);
    process.exit(1);
  }
})();
