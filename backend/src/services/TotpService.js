/**
 * TotpService — TOTP secret generation and verification via speakeasy
 */
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const APP_NAME = 'AgentGuard';

/**
 * Generates a new TOTP secret and a QR code data URL for the user to scan.
 * @param {string} email - The user's email (shown in authenticator app)
 * @returns {{ secret: string, qrCodeUrl: string, otpauthUrl: string }}
 */
async function generateTotpSecret(email) {
  const secret = speakeasy.generateSecret({
    name: `${APP_NAME} (${email})`,
    issuer: APP_NAME,
    length: 20,
  });

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  return {
    secret: secret.base32, // store this (encrypted ideally) in DB
    qrCodeUrl,             // data:image/png;base64,... for displaying in UI
    otpauthUrl: secret.otpauth_url,
  };
}

/**
 * Verifies a TOTP token against a stored secret.
 * Uses a ±1 window to account for clock drift.
 * @param {string} secret - The base32 secret stored in DB
 * @param {string} token  - The 6-digit code from the user
 * @returns {boolean}
 */
function verifyTotpToken(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1,
  });
}

module.exports = { generateTotpSecret, verifyTotpToken };
