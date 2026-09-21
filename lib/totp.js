const crypto = require('crypto');

/**
 * Hand-built RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation for Admin >
 * Security Dashboard's 2FA, using only Node's built-in `crypto` module.
 * package.json has no speakeasy/otplib/qrcode dependency, and none has
 * been added for this — so enrollment (routes/admin.js's
 * GET /admin/security/2fa/enable, views/admin/security-2fa-enable.ejs)
 * shows the base32 secret as plain text for the admin to type into any
 * standard authenticator app (Google Authenticator, Authy, etc.) by hand,
 * rather than a scannable QR code.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// A fresh random 160-bit (20-byte) secret, base32-encoded — the standard
// key size recommended by RFC 4226 for HMAC-SHA1.
function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

// RFC 4226 HOTP: HMAC-SHA1 of an 8-byte big-endian counter, dynamically
// truncated to a 6-digit code.
function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  // Node has no writeBigUInt64BE-free path we want to depend on here, so
  // the 64-bit counter is written as two 32-bit big-endian halves instead.
  counterBuffer.writeUInt32BE(Math.floor(counter / 4294967296), 0);
  counterBuffer.writeUInt32BE(counter % 4294967296, 4);
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 1000000).padStart(6, '0');
}

// RFC 6238 TOTP: HOTP with counter = floor(unixTime / step).
function generateTotp(secretBase32, atTimeMs = Date.now(), step = 30) {
  const counter = Math.floor(atTimeMs / 1000 / step);
  return hotp(secretBase32, counter);
}

// Accepts the current 30s step and one step on either side (±30s clock
// drift tolerance), matching how every mainstream authenticator app behaves.
function verifyTotp(secretBase32, token, atTimeMs = Date.now(), step = 30, window = 1) {
  const clean = String(token || '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(atTimeMs / 1000 / step);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    if (hotp(secretBase32, counter + errorWindow) === clean) return true;
  }
  return false;
}

module.exports = { base32Encode, base32Decode, generateSecret, generateTotp, verifyTotp, hotp };
