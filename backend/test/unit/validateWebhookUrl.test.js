/**
 * test/unit/validateWebhookUrl.test.js
 *
 * Tests for Fix #3: SSRF prevention via validateWebhookUrl().
 *
 * Covers:
 *   - Protocol enforcement (https only)
 *   - Localhost/loopback rejection by name
 *   - Private RFC-1918 ranges blocked after DNS resolution
 *   - Link-local (AWS metadata 169.254.x.x) blocked
 *   - Valid public HTTPS URLs accepted
 *   - DNS rebinding simulation: if a hostname later resolves to a private IP,
 *     the send-time re-validation must catch it
 */
'use strict';

jest.setTimeout(15000);

const { validateWebhookUrl, isPrivateIPv4, isPrivateIPv6 } = require('../../src/utils/validateWebhookUrl');

// ─── isPrivateIPv4 unit tests ─────────────────────────────────────────────────
describe('isPrivateIPv4 helper', () => {
  const privateAddresses = [
    '127.0.0.1',       // loopback
    '10.0.0.1',        // RFC-1918
    '10.255.255.255',  // RFC-1918
    '172.16.0.1',      // RFC-1918
    '172.31.255.255',  // RFC-1918
    '192.168.0.1',     // RFC-1918
    '192.168.255.255', // RFC-1918
    '169.254.169.254', // AWS metadata
    '169.254.0.1',     // link-local
    '100.64.0.1',      // carrier-grade NAT
  ];

  const publicAddresses = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34', // example.com
    '104.18.0.0',    // Cloudflare
  ];

  test.each(privateAddresses)('blocks private IP: %s', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
  });

  test.each(publicAddresses)('allows public IP: %s', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(false);
  });
});

// ─── isPrivateIPv6 helper ─────────────────────────────────────────────────────
describe('isPrivateIPv6 helper', () => {
  test('blocks ::1 (IPv6 loopback)', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
  });

  test('blocks fe80:: (link-local)', () => {
    expect(isPrivateIPv6('fe80::1')).toBe(true);
  });

  test('blocks fc00:: (unique-local)', () => {
    expect(isPrivateIPv6('fc00::1')).toBe(true);
  });

  test('allows public IPv6', () => {
    expect(isPrivateIPv6('2606:4700::6810:f8f8')).toBe(false);
  });
});

// ─── validateWebhookUrl — protocol and name checks (synchronous-ish) ──────────
describe('validateWebhookUrl — protocol and name enforcement', () => {
  test('BLOCKED: http:// URL is rejected (must be https)', async () => {
    await expect(validateWebhookUrl('http://example.com/hook'))
      .rejects.toThrow(/HTTPS/i);
  });

  test('BLOCKED: ftp:// URL is rejected', async () => {
    await expect(validateWebhookUrl('ftp://example.com/hook'))
      .rejects.toThrow(/HTTPS/i);
  });

  test('BLOCKED: file:// URL is rejected', async () => {
    await expect(validateWebhookUrl('file:///etc/passwd'))
      .rejects.toThrow(/HTTPS/i);
  });

  test('BLOCKED: localhost by name is rejected before DNS', async () => {
    await expect(validateWebhookUrl('https://localhost/hook'))
      .rejects.toThrow(/loopback/i);
  });

  test('BLOCKED: 127.0.0.1 by name is rejected before DNS', async () => {
    await expect(validateWebhookUrl('https://127.0.0.1/hook'))
      .rejects.toThrow(/loopback/i);
  });

  test('BLOCKED: not a valid URL at all', async () => {
    await expect(validateWebhookUrl('not-a-url'))
      .rejects.toThrow(/valid URL/i);
  });

  test('BLOCKED: empty string rejected', async () => {
    await expect(validateWebhookUrl(''))
      .rejects.toThrow(/non-empty/i);
  });
});

// ─── validateWebhookUrl — DNS resolution checks ───────────────────────────────
// We mock dns.promises.lookup to avoid real network calls and simulate
// the exact IPs an attacker might try to reach.
describe('validateWebhookUrl — DNS resolution blocks internal IPs', () => {
  const dns = require('dns').promises;

  beforeEach(() => {
    jest.spyOn(dns, 'lookup');
  });

  afterEach(() => {
    dns.lookup.mockRestore();
  });

  test('BLOCKED: hostname resolving to 169.254.169.254 (AWS metadata) is rejected', async () => {
    dns.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(validateWebhookUrl('https://metadata.evil.example.com/hook'))
      .rejects.toThrow(/private\/reserved/i);
  });

  test('BLOCKED: hostname resolving to 10.0.0.1 (RFC-1918) is rejected', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    await expect(validateWebhookUrl('https://internal.corp.example.com/api'))
      .rejects.toThrow(/private\/reserved/i);
  });

  test('BLOCKED: hostname resolving to 192.168.1.100 is rejected', async () => {
    dns.lookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);
    await expect(validateWebhookUrl('https://router.local/webhook'))
      .rejects.toThrow(/private\/reserved/i);
  });

  test('BLOCKED: hostname resolving to 172.16.0.1 is rejected', async () => {
    dns.lookup.mockResolvedValue([{ address: '172.16.0.1', family: 4 }]);
    await expect(validateWebhookUrl('https://internal.example.com/hook'))
      .rejects.toThrow(/private\/reserved/i);
  });

  test('DNS rebinding simulation: host that later resolves to 10.x.x.x is blocked at send time', async () => {
    // At registration time: resolves to public IP (would be accepted)
    dns.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    // At send time (second call): resolves to private IP (DNS rebinding attack)
    dns.lookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);

    // First call: accepted (simulates registration-time check passing)
    await expect(validateWebhookUrl('https://rebind.attacker.com/hook')).resolves.toBeUndefined();

    // Second call: same URL, but now resolves to private IP → must be blocked
    await expect(validateWebhookUrl('https://rebind.attacker.com/hook'))
      .rejects.toThrow(/private\/reserved/i);
  });

  test('ALLOWED: hostname resolving to public IP passes validation', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    // Should resolve without throwing
    await expect(validateWebhookUrl('https://example.com/webhook')).resolves.toBeUndefined();
  });

  test('BLOCKED: hostname that does not resolve (NXDOMAIN) is rejected', async () => {
    dns.lookup.mockRejectedValue(new Error('ENOTFOUND nonexistent.invalid'));
    await expect(validateWebhookUrl('https://nonexistent.invalid/hook'))
      .rejects.toThrow(/could not be resolved/i);
  });
});
