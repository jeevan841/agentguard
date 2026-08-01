/**
 * validateWebhookUrl.js
 *
 * Validates webhook URLs at registration and pre-dispatch to prevent SSRF.
 *
 * Checks enforced:
 *   1. Must be HTTPS (no http:// leaks plaintext; no file://, localhost shorthand, etc.)
 *   2. Must not be localhost by hostname string
 *   3. Must resolve to a public routable IP — not RFC-1918 private, loopback,
 *      link-local (169.254/16), or the AWS metadata endpoint (169.254.169.254)
 *
 * Called at:
 *   - Webhook/alert creation time (POST /dashboard/webhooks, POST /dashboard/alerts)
 *   - Update time (PUT /dashboard/alerts/:id, PUT /dashboard/webhooks/:id)
 *   - SEND time in AlertService.sendWebhook() to guard against DNS rebinding:
 *     a hostname that resolves to a public IP at registration time could be
 *     re-pointed to a private IP before the next send cycle.
 */
'use strict';

const dns = require('dns').promises;
const net = require('net');

// Private, loopback, and link-local CIDR ranges that are never valid webhook targets.
// Represented as [network_bigint, mask_bigint, label] for fast lookup.
const BLOCKED_RANGES = (() => {
  function cidrToBigInt(cidr) {
    const [addr, bits] = cidr.split('/');
    const parts = addr.split('.').map(Number);
    const n = BigInt((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]);
    const mask = BigInt(0xffffffff) << BigInt(32 - parseInt(bits));
    return [n & mask, mask, cidr];
  }

  return [
    '127.0.0.0/8',      // loopback
    '10.0.0.0/8',       // RFC-1918 private
    '172.16.0.0/12',    // RFC-1918 private
    '192.168.0.0/16',   // RFC-1918 private
    '169.254.0.0/16',   // link-local (AWS metadata, APIPA)
    '100.64.0.0/10',    // Shared address space (RFC 6598 — carrier-grade NAT)
    '0.0.0.0/8',        // This network
  ].map(cidrToBigInt);
})();

/**
 * Returns true if an IPv4 address string falls within any blocked range.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIPv4(ip) {
  if (!net.isIPv4(ip)) return false;
  const parts = ip.split('.').map(Number);
  const n = BigInt((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]);
  return BLOCKED_RANGES.some(([network, mask]) => (n & mask) === network);
}

/**
 * Returns true if an IPv6 address is loopback or link-local.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIPv6(ip) {
  if (!net.isIPv6(ip)) return false;
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||                    // IPv6 loopback
    normalized.startsWith('fe80:') ||          // link-local
    normalized.startsWith('fc') ||             // unique-local
    normalized.startsWith('fd')                // unique-local
  );
}

/**
 * Resolves the hostname in a URL and returns all resolved IP addresses.
 * @param {string} hostname
 * @returns {Promise<string[]>}
 */
async function resolveHostname(hostname) {
  try {
    const result = await dns.lookup(hostname, { all: true });
    return result.map((r) => r.address);
  } catch {
    return [];
  }
}

/**
 * Validates a webhook URL for SSRF safety.
 * Throws a descriptive Error if the URL is not safe.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
async function validateWebhookUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Webhook URL must be a non-empty string.');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Webhook URL is not a valid URL: ${url}`);
  }

  // 1. Protocol must be https
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Webhook URL must use HTTPS. Got: ${parsed.protocol}. ` +
      `Only https:// URLs are accepted.`
    );
  }

  const { hostname } = parsed;

  // 2. Reject localhost by name (before DNS)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error(`Webhook URL resolves to a loopback address: ${hostname}`);
  }

  // 3. Resolve the hostname and reject any private/loopback IPs
  const addresses = await resolveHostname(hostname);
  if (addresses.length === 0) {
    throw new Error(`Webhook URL hostname could not be resolved: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateIPv4(addr) || isPrivateIPv6(addr)) {
      throw new Error(
        `Webhook URL resolves to a private/reserved IP address (${addr}) and cannot be used. ` +
        `This could be a Server-Side Request Forgery (SSRF) attempt.`
      );
    }
  }
}

module.exports = { validateWebhookUrl, isPrivateIPv4, isPrivateIPv6, resolveHostname };
