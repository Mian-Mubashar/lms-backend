const nodemailer = require('nodemailer');
const { loadEnv } = require('./loadEnv');
const { buildPasswordResetEmailHtml } = require('./emailTemplates/passwordReset');

loadEnv();

const stripQuotes = (value) => {
  const v = String(value || '').trim();
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    return v.slice(1, -1);
  }
  return v;
};

const getEmailConfig = () => {
  const host = (process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT) || 587;
  const user = stripQuotes(process.env.SMTP_USER || process.env.EMAIL_USER || '');
  const pass = stripQuotes(
    process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.EMAIL_PASS || ''
  );
  const secure =
    String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  return { host, port, user, pass, secure };
};

const isEmailConfigured = () => {
  const { user, pass } = getEmailConfig();
  return Boolean(user && pass);
};

let transporter = null;
let transporterKey = '';

const buildTransporter = () => {
  const { host, port, user, pass, secure } = getEmailConfig();
  const key = `${host}|${port}|${secure}|${user}|${pass}`;

  if (transporter && transporterKey === key) {
    return transporter;
  }

  const useGmail =
    !process.env.SMTP_HOST &&
    (host.includes('gmail.com') || user.endsWith('@gmail.com'));

  // Shared hosting SMTP is more reliable without connection pooling.
  transporter = nodemailer.createTransport(
    useGmail
      ? {
          service: 'gmail',
          auth: { user, pass }
        }
      : {
          host,
          port,
          secure,
          auth: { user, pass },
          tls: { minVersion: 'TLSv1.2' }
        }
  );

  transporterKey = key;
  return transporter;
};

const sendPasswordResetEmail = async ({ to, resetCode, firstName = 'User' }) => {
  if (!isEmailConfigured()) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  const { user } = getEmailConfig();
  const mail = buildTransporter();
  const frontendUrl =
    (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '') + '/forgot-password';

  await mail.sendMail({
    from: `"AI LMS" <${user}>`,
    to,
    replyTo: user,
    subject: `AI LMS reset code: ${resetCode}`,
    priority: 'high',
    text: [
      `Hi ${firstName},`,
      '',
      `Your password reset code is: ${resetCode}`,
      '',
      'This code expires in 15 minutes.',
      `Reset page: ${frontendUrl}`,
      '',
      'AI LMS Team'
    ].join('\n'),
    html: buildPasswordResetEmailHtml({ firstName, resetCode, frontendUrl })
  });
};

module.exports = {
  isEmailConfigured,
  sendPasswordResetEmail,
  getEmailConfig
};
