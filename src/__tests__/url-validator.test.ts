import { describe, it, expect } from "vitest";
import { validateProxyUrl } from "@/lib/url-validator";

describe("validateProxyUrl", () => {
  // --- Should ALLOW ---
  it("allows normal HTTP URLs", () => {
    expect(validateProxyUrl("https://example.com")).toEqual({ valid: true });
    expect(validateProxyUrl("http://example.com/page")).toEqual({ valid: true });
    expect(validateProxyUrl("https://en.wikipedia.org/wiki/Cat")).toEqual({ valid: true });
  });

  it("allows URLs with ports", () => {
    expect(validateProxyUrl("https://example.com:8080/path")).toEqual({ valid: true });
  });

  // --- Should BLOCK: localhost ---
  it("blocks localhost", () => {
    expect(validateProxyUrl("http://localhost")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://localhost:3000")).toHaveProperty("valid", false);
    expect(validateProxyUrl("https://localhost/admin")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: loopback 127.0.0.0/8 ---
  it("blocks 127.0.0.0/8 (loopback)", () => {
    expect(validateProxyUrl("http://127.0.0.1")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://127.0.0.1:8080")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://127.1.2.3")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://127.255.255.255")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: 10.0.0.0/8 ---
  it("blocks 10.0.0.0/8 (private)", () => {
    expect(validateProxyUrl("http://10.0.0.1")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://10.255.255.255")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: 172.16.0.0/12 ---
  it("blocks 172.16.0.0/12 (private)", () => {
    expect(validateProxyUrl("http://172.16.0.1")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://172.31.255.255")).toHaveProperty("valid", false);
  });

  it("allows 172.32.0.0 (outside /12 range)", () => {
    expect(validateProxyUrl("http://172.32.0.1")).toEqual({ valid: true });
  });

  // --- Should BLOCK: 192.168.0.0/16 ---
  it("blocks 192.168.0.0/16 (private)", () => {
    expect(validateProxyUrl("http://192.168.0.1")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://192.168.1.1")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://192.168.255.255")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: 169.254.0.0/16 (link-local / cloud metadata) ---
  it("blocks 169.254.0.0/16 (link-local / cloud metadata)", () => {
    expect(validateProxyUrl("http://169.254.169.254")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://169.254.169.254/latest/meta-data/")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://169.254.0.1")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: 0.0.0.0 ---
  it("blocks 0.0.0.0", () => {
    expect(validateProxyUrl("http://0.0.0.0")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://0.0.0.0:8080")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: IPv6 loopback ---
  it("blocks IPv6 loopback ::1", () => {
    expect(validateProxyUrl("http://[::1]")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://[::1]:3000")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: non-http schemes ---
  it("blocks file:// scheme", () => {
    expect(validateProxyUrl("file:///etc/passwd")).toHaveProperty("valid", false);
  });

  it("blocks ftp:// scheme", () => {
    expect(validateProxyUrl("ftp://example.com")).toHaveProperty("valid", false);
  });

  it("blocks gopher:// scheme", () => {
    expect(validateProxyUrl("gopher://example.com")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: credentials in URL ---
  it("blocks URLs with credentials", () => {
    expect(validateProxyUrl("http://user:pass@example.com")).toHaveProperty("valid", false);
    expect(validateProxyUrl("http://admin@192.168.1.1")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: numeric IP obfuscation ---
  it("blocks decimal IP obfuscation (2130706433 = 127.0.0.1)", () => {
    expect(validateProxyUrl("http://2130706433")).toHaveProperty("valid", false);
  });

  it("blocks hex IP obfuscation (0x7f000001 = 127.0.0.1)", () => {
    expect(validateProxyUrl("http://0x7f000001")).toHaveProperty("valid", false);
  });

  // --- Should BLOCK: special hostnames ---
  it("blocks metadata.google.internal", () => {
    expect(validateProxyUrl("http://metadata.google.internal")).toHaveProperty("valid", false);
  });

  // --- Edge cases ---
  it("rejects empty/null input", () => {
    expect(validateProxyUrl("")).toHaveProperty("valid", false);
    expect(validateProxyUrl("not-a-url")).toHaveProperty("valid", false);
  });
});
