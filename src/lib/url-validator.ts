/**
 * URL Validation & SSRF Protection
 * 
 * Blocks private IPs, cloud metadata endpoints, non-http schemes,
 * and other SSRF vectors. Applied to all proxy/fetch endpoints.
 */

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** IPv4 private/reserved ranges */
const PRIVATE_IPV4_RANGES = [
  // 10.0.0.0/8
  { start: ipToNum("10.0.0.0"), end: ipToNum("10.255.255.255") },
  // 172.16.0.0/12
  { start: ipToNum("172.16.0.0"), end: ipToNum("172.31.255.255") },
  // 192.168.0.0/16
  { start: ipToNum("192.168.0.0"), end: ipToNum("192.168.255.255") },
  // 127.0.0.0/8 (loopback)
  { start: ipToNum("127.0.0.0"), end: ipToNum("127.255.255.255") },
  // 169.254.0.0/16 (link-local / cloud metadata)
  { start: ipToNum("169.254.0.0"), end: ipToNum("169.254.255.255") },
  // 0.0.0.0/8
  { start: ipToNum("0.0.0.0"), end: ipToNum("0.255.255.255") },
];

/** Hostnames that resolve to loopback/private */
const BLOCKED_HOSTNAMES = [
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.google",
  "kubernetes.default.svc",
];

/** Blocked schemes */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function ipToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  // Check if it's a valid IPv4
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every(p => { const n = Number(p); return !isNaN(n) && n >= 0 && n <= 255; })) return false;
  
  const num = ipToNum(ip);
  return PRIVATE_IPV4_RANGES.some(range => num >= range.start && num <= range.end);
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/\[|\]/g, "");
  
  // ::1 (loopback)
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  
  // fc00::/7 (unique local)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  
  // fe80::/10 (link-local)
  if (normalized.startsWith("fe80")) return true;
  
  // :: (unspecified)
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  return false;
}

/**
 * Validate a URL for proxy use. Returns { valid: true } or { valid: false, reason: "..." }.
 */
export function validateProxyUrl(urlString: string): ValidationResult {
  if (!urlString || typeof urlString !== "string") {
    return { valid: false, reason: "Empty or invalid URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: "Malformed URL" };
  }

  // Scheme check
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { valid: false, reason: `Blocked scheme: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, reason: `Blocked hostname: ${hostname}` };
  }

  // Direct IP checks
  if (isPrivateIPv4(hostname)) {
    return { valid: false, reason: `Blocked private IPv4: ${hostname}` };
  }

  if (isPrivateIPv6(hostname)) {
    return { valid: false, reason: `Blocked private IPv6: ${hostname}` };
  }

  // Detect IPv4 in brackets or other obfuscation
  const bracketless = hostname.replace(/\[|\]/g, "");
  if (isPrivateIPv4(bracketless)) {
    return { valid: false, reason: `Blocked private IP (obfuscated): ${hostname}` };
  }

  // Block numeric IP obfuscation: decimal (2130706433 = 127.0.0.1), octal (0177.0.0.1), hex (0x7f000001)
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (!isNaN(num) && num <= 0xFFFFFFFF) {
      const ip = `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
      if (isPrivateIPv4(ip)) {
        return { valid: false, reason: `Blocked numeric IP: ${hostname} → ${ip}` };
      }
    }
  }

  // Block hex IP (0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const num = parseInt(hostname, 16);
    if (!isNaN(num) && num <= 0xFFFFFFFF) {
      const ip = `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
      if (isPrivateIPv4(ip)) {
        return { valid: false, reason: `Blocked hex IP: ${hostname} → ${ip}` };
      }
    }
  }

  // Block URLs with credentials (user:pass@host)
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "URLs with credentials are not allowed" };
  }

  return { valid: true };
}

/**
 * Middleware helper for Next.js API routes.
 * Returns a Response if the URL is invalid, or null if valid.
 */
export function validateOrReject(url: string | null): Response | null {
  if (!url) {
    return new Response(JSON.stringify({ error: "url required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = validateProxyUrl(url);
  if (!result.valid) {
    console.warn(`[SSRF] Blocked request to: ${url} — ${result.reason}`);
    return new Response(JSON.stringify({ error: "URL not allowed", reason: result.reason }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}
