import { describe, expect, it, vi } from "vitest";
import { classifyBotChallenge, detectPageBotChallenge } from "@/lib/agent/google-gate";
import { extractTrustCookies } from "@/lib/agent/sessions";
import { handOffBotChallenge, type SearchSession } from "@/lib/agent/web-search";
import {
  deriveFollowUpActions,
  extractCodeArtifacts,
  extractResearchSources,
  formatChatAsMarkdown,
  isPreviewableCode,
} from "@/components/assistant/workspace-artifacts";

describe("universal bot-verification classifier (classifyBotChallenge)", () => {
  it("identifies Google /sorry and captcha-form pages", () => {
    const info = classifyBotChallenge({
      url: "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dtest",
      title: "Sorry...",
      bodyText: "Our systems have detected unusual traffic from your computer network.",
    });
    expect(info).not.toBeNull();
    expect(info?.provider).toBe("google");
    expect(info?.autoResolvable).toBe(false);
  });

  it("identifies Cloudflare Turnstile & Just a moment interstitials", () => {
    const interactive = classifyBotChallenge({
      url: "https://example.com/pricing",
      title: "Just a moment...",
      bodyText: "example.com\nVerify you are human by completing the action below.\nPerformance & security by Cloudflare",
      hasChallengeWidget: true,
      challengeProviderHint: "cloudflare",
    });
    expect(interactive).not.toBeNull();
    expect(interactive?.provider).toBe("cloudflare");
    expect(interactive?.host).toBe("example.com");
    expect(interactive?.autoResolvable).toBe(false);

    const jsWait = classifyBotChallenge({
      url: "https://docs.example.org/api",
      title: "Just a moment...",
      bodyText: "Checking if the site connection is secure...",
      hasChallengeWidget: false,
    });
    expect(jsWait?.provider).toBe("cloudflare");
    expect(jsWait?.autoResolvable).toBe(true);
  });

  it("identifies PerimeterX and DataDome verification pages", () => {
    const px = classifyBotChallenge({
      url: "https://shop.example.com/item/12",
      title: "Robot or human?",
      bodyText: "Press & Hold to confirm you are a human (and not a bot). Reference ID: 12345",
      challengeProviderHint: "perimeterx",
    });
    expect(px?.provider).toBe("perimeterx");

    const dd = classifyBotChallenge({
      url: "https://tickets.example.com/",
      title: "Security Check",
      bodyText: "Your browser or network behavior has triggered our security system. Protected by DataDome.",
      challengeProviderHint: "datadome",
    });
    expect(dd?.provider).toBe("datadome");
  });

  it("never false-positives on normal long articles discussing Cloudflare or CAPTCHAs", () => {
    const longArticle =
      "How Cloudflare Turnstile and reCAPTCHA work to verify you are human. ".repeat(60);
    const res = classifyBotChallenge({
      url: "https://blog.example.com/cloudflare-turnstile-guide",
      title: "Understanding Bot Verification and CAPTCHAs",
      bodyText: longArticle,
      hasChallengeWidget: false,
    });
    expect(res).toBeNull();
  });

  it("leaves a normal form with an embedded Turnstile widget alone", () => {
    expect(classifyBotChallenge({
      url: "https://example.com/contact",
      title: "Contact us",
      bodyText: "Your email\nMessage\nSend",
      hasChallengeWidget: true,
      challengeProviderHint: "cloudflare",
    })).toBeNull();
  });
});

describe("extractTrustCookies", () => {
  it("preserves Google trust cookies and cross-site clearance cookies (cf_clearance, datadome, _px3) while excluding login cookies", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const expired = Math.floor(Date.now() / 1000) - 3600;
    const storage = {
      cookies: [
        { name: "NID", value: "g1", domain: ".google.com", path: "/", expires: future, httpOnly: true, secure: true, sameSite: "None" },
        { name: "SID", value: "secret-login", domain: ".google.com", path: "/", expires: future, httpOnly: true, secure: true, sameSite: "None" },
        { name: "cf_clearance", value: "cf123", domain: ".example.com", path: "/", expires: future, httpOnly: true, secure: true, sameSite: "None" },
        { name: "datadome", value: "dd456", domain: ".shop.com", path: "/", expires: future, httpOnly: false, secure: true, sameSite: "Lax" },
        { name: "session_token", value: "user_secret", domain: ".example.com", path: "/", expires: future, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "cf_clearance", value: "old", domain: ".expired.com", path: "/", expires: expired, httpOnly: true, secure: true, sameSite: "None" },
      ],
    };
    const trust = extractTrustCookies(storage);
    expect(trust.map((c) => c.name)).toEqual(["NID", "cf_clearance", "datadome"]);
  });
});

describe("handOffBotChallenge", () => {
  it("hands browser control to a connected viewer, emits verification state, and persists cookies when cleared", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_CAPTCHA_WAIT_MS", "60000"); // the hand-off is opt-in
    let blocked = true;
    const persisted = vi.fn(async () => {});
    const verifications: unknown[] = [];
    const page = {
      url: () => "https://example.com/protected",
      evaluate: vi.fn(async () =>
        blocked
          ? {
              title: "Just a moment...",
              bodyText: "Verify you are human by completing the action below.",
              hasChallengeWidget: true,
              challengeProviderHint: "cloudflare" as const,
            }
          : {
              title: "Example Product Page",
              bodyText: "Welcome to our store! Here are the products.",
              hasChallengeWidget: false,
              challengeProviderHint: "" as const,
            },
      ),
    };

    const session: SearchSession = {
      context: {} as never,
      takeover: false,
      active: () => page as never,
      log: vi.fn(),
      setTakeover(on: boolean) {
        this.takeover = on;
      },
      viewerCount: () => 1,
      setVerification: (info) => verifications.push(info),
      persist: persisted,
    };

    const challenge = await detectPageBotChallenge(page);
    expect(challenge?.provider).toBe("cloudflare");

    const ctl = new AbortController();
    const job = handOffBotChallenge(session, challenge!, ctl.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(session.takeover).toBe(true);
    expect(verifications[0]).toMatchObject({ provider: "cloudflare", host: "example.com" });

    // Viewer solves the challenge
    blocked = false;
    await vi.advanceTimersByTimeAsync(2000);
    const solved = await job;
    expect(solved).toBe(true);
    expect(session.takeover).toBe(false);
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(verifications[verifications.length - 1]).toBeNull();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
});

describe("Adaptive Workspace artifact extraction & contextual follow-ups", () => {
  it("extracts code artifacts, infers filenames, and flags previewable HTML/SVG/Markdown", () => {
    const messages = [
      { id: "m1", role: "user" as const, content: "Create an HTML dashboard and a Python helper" },
      {
        id: "m2",
        role: "assistant" as const,
        content: [
          "Here is the dashboard:",
          "```html",
          "<!doctype html><html><head><title>Solar Dashboard</title></head><body><h1>Hello</h1></body></html>",
          "```",
          "And the script:",
          "```python",
          "# scripts/metrics.py",
          "def compute_efficiency(output, input_power):",
          "    return round(output / max(input_power, 1), 4)",
          "```",
          "```ui",
          '{"type":"stat_grid","stats":[]}',
          "```",
        ].join("\n"),
      },
    ];

    const artifacts = extractCodeArtifacts(messages);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      language: "html",
      filename: "solar-dashboard.html",
      previewable: true,
    });
    expect(artifacts[1]).toMatchObject({
      language: "python",
      filename: "metrics.py",
      previewable: false,
    });
    expect(isPreviewableCode("svg", "<svg viewBox='0 0 10 10'></svg>")).toBe(true);
  });

  it("extracts deduplicated research sources and derives contextual follow-ups", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant" as const,
        content: "According to [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web) and https://web.dev/articles/vitals, performance matters.",
      },
    ];
    const sources = extractResearchSources(
      messages,
      [{ id: 1, label: "Opened W3C", status: "done", url: "https://www.w3.org/TR/", shotId: "s_123" }],
      [{ title: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web" }],
    );
    expect(sources).toHaveLength(3);
    expect(sources.find((s) => s.host === "w3.org")?.shotId).toBe("s_123");

    const followUps = deriveFollowUpActions(messages[0].content, "chat", [], sources.length);
    expect(followUps.some((f) => f.action === "open-sources")).toBe(true);

    const md = formatChatAsMarkdown("Perf Audit", messages);
    expect(md).toContain("# Perf Audit");
    expect(md).toContain("### Senko AI");
  });
});
