/**
 * Auth Routes — Full MFA support
 *
 * POST /auth/register           - Register + send verification email
 * GET  /auth/verify-email       - Verify email via token link
 * POST /auth/resend-verification- Resend verification email
 * POST /auth/login              - Step 1: password check
 * POST /auth/mfa/email-otp      - Step 2: verify email OTP
 * POST /auth/mfa/totp           - Step 3: verify TOTP (optional)
 * GET  /auth/me                 - Current user
 * POST /auth/2fa/setup          - Generate TOTP secret + QR code
 * POST /auth/2fa/confirm        - Confirm TOTP code & activate level 3
 * DELETE /auth/2fa/totp         - Disable TOTP (revert to level 2)
 * PUT  /auth/mfa/level          - Set mfa_level (1 or 2)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../prisma/client');
const { generateManagementToken, requireAuth } = require('../middleware/auth');
const { sendVerificationEmail, sendOtpEmail } = require('../services/EmailService');
const { generateTotpSecret, verifyTotpToken } = require('../services/TotpService');
const { generateAndStoreOtp, verifyAndConsumeOtp } = require('../services/OtpStore');
const config = require('../config');

const router = express.Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Issues a short-lived temp token used to hold MFA state between steps */
function generateTempToken(userId, nextStep) {
  return jwt.sign(
    { userId, nextStep, type: 'mfa_temp' },
    config.jwt.secret,
    { expiresIn: '10m' }
  );
}

function verifyTempToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = RegisterSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const verifyToken = uuidv4();
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || 'Admin',
        email_verified: false,
        email_verify_token: verifyToken,
        email_verify_expires: verifyExpires,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    // Send verification email (non-blocking)
    sendVerificationEmail(email, user.name, verifyToken).catch((err) =>
      console.warn('[Email] Verification send failed:', err.message)
    );

    res.status(201).json({
      user,
      email_verification_required: true,
      message: 'Account created. Please check your email to verify your account.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /auth/verify-email?token= ───────────────────────────────────────────
router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Bad Request', message: 'Token is required' });

    const user = await prisma.user.findUnique({ where: { email_verify_token: token } });

    if (!user || !user.email_verify_expires || user.email_verify_expires < new Date()) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid or expired verification link' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        email_verify_token: null,
        email_verify_expires: null,
      },
    });

    res.json({ success: true, message: 'Email verified successfully. You may now log in.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/resend-verification ──────────────────────────────────────────
router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Bad Request', message: 'email is required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.email_verified) {
      return res.json({ message: 'If the account exists and is unverified, a new email has been sent.' });
    }

    const verifyToken = uuidv4();
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { email_verify_token: verifyToken, email_verify_expires: verifyExpires },
    });

    sendVerificationEmail(email, user.name, verifyToken).catch(() => {});
    res.json({ message: 'Verification email resent.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/login (Step 1 — password) ────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    // Unverified — block login
    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Please verify your email before logging in.',
        email_verification_required: true,
        email: user.email,
      });
    }

    // MFA level 1 — plain password, done
    if (user.mfa_level === 1) {
      const token = generateManagementToken(user);
      return res.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
        expires_in: '7d',
      });
    }

    // MFA level 2+ — send email OTP, return temp token
    const otp = await generateAndStoreOtp(user.id);
    sendOtpEmail(user.email, user.name, otp).catch((err) =>
      console.warn('[Email] OTP send failed:', err.message)
    );

    const tempToken = generateTempToken(user.id, 'email_otp');
    res.json({
      mfa_required: true,
      next_step: 'email_otp',
      temp_token: tempToken,
      message: 'A login code has been sent to your email.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/mfa/email-otp (Step 2 — email OTP) ───────────────────────────
router.post('/mfa/email-otp', async (req, res, next) => {
  try {
    const { temp_token, code } = req.body;
    if (!temp_token || !code) {
      return res.status(400).json({ error: 'Bad Request', message: 'temp_token and code are required' });
    }

    const payload = verifyTempToken(temp_token);
    if (!payload || payload.nextStep !== 'email_otp') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session' });
    }

    const result = await verifyAndConsumeOtp(payload.userId, code);

    if (result.locked) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.',
      });
    }

    if (!result.valid) {
      const hint = result.remainingAttempts !== undefined
        ? ` (${result.remainingAttempts} attempt${result.remainingAttempts !== 1 ? 's' : ''} remaining)`
        : '';
      return res.status(401).json({ error: 'Unauthorized', message: `Invalid or expired OTP code${hint}` });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    // If level 3 (TOTP enabled) — return new temp token for TOTP step
    if (user.mfa_level === 3 && user.totp_enabled) {
      const nextTempToken = generateTempToken(user.id, 'totp');
      return res.json({
        mfa_required: true,
        next_step: 'totp',
        temp_token: nextTempToken,
        message: 'Please enter your authenticator app code.',
      });
    }

    // Level 2 — all steps done, issue full JWT
    const token = generateManagementToken(user);
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
      expires_in: '7d',
    });
  } catch (err) {
    next(err);
  }
});


// ─── POST /auth/mfa/totp (Step 3 — TOTP, optional) ───────────────────────────
router.post('/mfa/totp', async (req, res, next) => {
  try {
    const { temp_token, code } = req.body;
    if (!temp_token || !code) {
      return res.status(400).json({ error: 'Bad Request', message: 'temp_token and code are required' });
    }

    const payload = verifyTempToken(temp_token);
    if (!payload || payload.nextStep !== 'totp') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.totp_secret || !user.totp_enabled) {
      return res.status(401).json({ error: 'Unauthorized', message: 'TOTP not configured' });
    }

    const valid = verifyTotpToken(user.totp_secret, code);
    if (!valid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid authenticator code' });
    }

    const token = generateManagementToken(user);
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
      expires_in: '7d',
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, name: true, role: true,
        email_verified: true, mfa_level: true, totp_enabled: true, created_at: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'Not Found', message: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/2fa/setup — Generate TOTP secret + QR ────────────────────────
router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { secret, qrCodeUrl } = await generateTotpSecret(user.email);

    // Store pending secret temporarily (not active until confirmed)
    await prisma.user.update({
      where: { id: user.id },
      data: { totp_secret: secret }, // activated once confirmed
    });

    res.json({ qr_code: qrCodeUrl, message: 'Scan the QR code with your authenticator app.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/2fa/confirm — Activate TOTP ───────────────────────────────────
router.post('/2fa/confirm', requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Bad Request', message: 'code is required' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.totp_secret) {
      return res.status(400).json({ error: 'Bad Request', message: 'Run /auth/2fa/setup first' });
    }

    const valid = verifyTotpToken(user.totp_secret, code);
    if (!valid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid code — try again' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totp_enabled: true, mfa_level: 3 },
    });

    res.json({ success: true, message: 'TOTP authenticator enabled. Login now requires 3 steps.' });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /auth/2fa/totp — Disable TOTP (revert level 2→1 optionally) ──────
router.delete('/2fa/totp', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Bad Request', message: 'password is required' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Unauthorized', message: 'Incorrect password' });

    await prisma.user.update({
      where: { id: user.id },
      data: { totp_secret: null, totp_enabled: false, mfa_level: Math.min(user.mfa_level, 2) },
    });

    res.json({ success: true, message: 'TOTP authenticator disabled.' });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /auth/mfa/level — Set mfa_level (1 or 2) ────────────────────────────
router.put('/mfa/level', requireAuth, async (req, res, next) => {
  try {
    const { level } = req.body;
    if (![1, 2].includes(level)) {
      return res.status(400).json({ error: 'Bad Request', message: 'level must be 1 or 2 (use /2fa/confirm for level 3)' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    // Downgrading to level 1 also disables TOTP
    const data = { mfa_level: level };
    if (level === 1 && user.totp_enabled) {
      data.totp_enabled = false;
      data.totp_secret = null;
    }

    await prisma.user.update({ where: { id: user.id }, data });
    res.json({ success: true, mfa_level: level });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
