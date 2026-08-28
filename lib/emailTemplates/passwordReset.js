const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Inline clipboard icon — emoji works reliably across Gmail/Outlook. */
const COPY_ICON = '📋';

const buildPasswordResetEmailHtml = ({ firstName, resetCode, frontendUrl }) => {
  const safeName = escapeHtml(firstName);
  const safeCode = escapeHtml(resetCode);
  const safeUrl = escapeHtml(frontendUrl || 'http://localhost:3000/forgot-password');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password reset code</title>
</head>
<body style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2ff;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0284c7 0%,#0ea5e9 100%);padding:28px 32px;text-align:center;">
              <div style="display:inline-block;width:52px;height:52px;line-height:52px;border-radius:50%;background:rgba(255,255,255,0.18);color:#ffffff;font-size:24px;font-weight:700;">AI</div>
              <h1 style="margin:14px 0 0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">Password Reset</h1>
              <p style="margin:8px 0 0;color:#e0f2fe;font-size:14px;">AI LMS secure verification</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hi <strong>${safeName}</strong>,</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569;">
                You requested a password reset for your AI LMS account. Use the verification code below to continue.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
                <tr>
                  <td style="padding:22px 24px;text-align:center;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;font-weight:700;">Your reset code</p>
                    <div style="display:inline-block;padding:16px 24px;border-radius:12px;background:#ffffff;border:2px dashed #38bdf8;">
                      <span style="font-size:34px;line-height:1;font-weight:800;letter-spacing:10px;color:#0284c7;font-family:Consolas,Monaco,'Courier New',monospace;-webkit-user-select:all;user-select:all;">${safeCode}</span>
                    </div>
                    <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin-top:14px;">
                      <tr>
                        <td style="vertical-align:middle;padding-right:8px;font-size:18px;line-height:1;">${COPY_ICON}</td>
                        <td style="vertical-align:middle;font-size:13px;color:#64748b;line-height:1.5;">
                          Click the code to select it, then copy with <strong>Ctrl+C</strong> (Mac: <strong>Cmd+C</strong>)
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;font-size:13px;line-height:1.6;color:#9a3412;">
                This code expires in <strong>15 minutes</strong>. Do not share it with anyone.
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:28px auto 0;">
                <tr>
                  <td style="border-radius:10px;background:#0284c7;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Open reset page</a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">
                If you did not request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} AI LMS · All rights reserved</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

module.exports = {
  buildPasswordResetEmailHtml,
  escapeHtml
};
