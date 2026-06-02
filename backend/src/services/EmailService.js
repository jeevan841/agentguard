/**
 * EmailService — Sends transactional emails via Nodemailer (Mailpit in dev)
 */
const nodemailer = require('nodemailer');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const EMAIL_FROM = process.env.EMAIL_FROM || 'AgentGuard <noreply@agentguard.io>';

// Create transport — points to Mailpit in dev, real SMTP in prod
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mailpit',
  port: parseInt(process.env.SMTP_PORT || '1025'),
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
  ignoreTLS: true,
});

/**
 * Sends an email verification link to a newly registered user.
 */
async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;

  await transport.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: 'Verify your AgentGuard account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f1623; color: #f1f5f9; padding: 40px; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; background: #6d28d9; padding: 12px; border-radius: 10px; margin-bottom: 16px;">
            <span style="font-size: 28px;">🛡️</span>
          </div>
          <h1 style="margin: 0; font-size: 24px; color: #fff;">AgentGuard</h1>
          <p style="color: #94a3b8; margin: 4px 0 0;">AI Governance & Security Platform</p>
        </div>

        <h2 style="color: #fff; font-size: 20px;">Hi ${name || 'there'},</h2>
        <p style="color: #cbd5e1; line-height: 1.6;">Thanks for registering. Please verify your email address to gain access to your AgentGuard dashboard.</p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: #6d28d9; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Verify Email Address
          </a>
        </div>

        <p style="color: #64748b; font-size: 13px;">This link expires in <strong style="color:#94a3b8;">24 hours</strong>. If you did not register, you can safely ignore this email.</p>
        <hr style="border: 1px solid #1e293b; margin: 24px 0;" />
        <p style="color: #475569; font-size: 12px; text-align: center;">AgentGuard · Enterprise AI Security</p>
      </div>
    `,
  });

  console.log(`[Email] Verification email sent to: ${email}`);
}

/**
 * Sends a time-limited 6-digit OTP for step-2 login.
 */
async function sendOtpEmail(email, name, otp) {
  await transport.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: 'Your AgentGuard login code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f1623; color: #f1f5f9; padding: 40px; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; background: #6d28d9; padding: 12px; border-radius: 10px; margin-bottom: 16px;">
            <span style="font-size: 28px;">🛡️</span>
          </div>
          <h1 style="margin: 0; font-size: 24px; color: #fff;">AgentGuard</h1>
        </div>

        <h2 style="color: #fff; font-size: 20px;">Hi ${name || 'there'},</h2>
        <p style="color: #cbd5e1; line-height: 1.6;">Your one-time login code is:</p>

        <div style="text-align: center; margin: 32px 0;">
          <div style="display: inline-block; background: #1e293b; border: 2px solid #6d28d9; border-radius: 12px; padding: 20px 40px;">
            <span style="font-size: 40px; font-weight: bold; letter-spacing: 10px; color: #a78bfa; font-family: monospace;">${otp}</span>
          </div>
        </div>

        <p style="color: #64748b; font-size: 13px; text-align: center;">This code expires in <strong style="color:#94a3b8;">10 minutes</strong>. Never share this code with anyone.</p>
        <hr style="border: 1px solid #1e293b; margin: 24px 0;" />
        <p style="color: #475569; font-size: 12px; text-align: center;">AgentGuard · Enterprise AI Security</p>
      </div>
    `,
  });

  console.log(`[Email] OTP email sent to: ${email}`);
}

module.exports = { sendVerificationEmail, sendOtpEmail };
