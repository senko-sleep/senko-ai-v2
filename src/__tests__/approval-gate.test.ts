import { beforeEach, describe, expect, it } from "vitest";
import { assessAction } from "@/lib/agent/risk";
import { auditLog, consumeApproval, denyApproval, getPendingApproval, grantApproval, requestApproval, resetApprovals } from "@/lib/agent/approvals";

type El = Parameters<typeof assessAction>[1][number];
const el = (id: number, text: string, extra: Partial<El> = {}): El => ({ id, tag: "button", type: "", text, href: "", ...extra });
const URL1 = "https://shop.example.com/cart";

describe("assessAction: what needs approval", () => {
  it.each([
    ["Place order", "financial"],
    ["Buy now", "financial"],
    ["Pay now", "financial"],
    ["Subscribe", "financial"],
    ["Delete account", "destructive"],
    ["Permanently delete", "destructive"],
    ["Cancel subscription", "destructive"],
    ["Change password", "security"],
    ["Authorize", "security"],
    ["Send message", "external"],
    ["Publish", "external"],
    ["Book now", "external"],
  ])("blocks %s as %s", (label, category) => {
    const r = assessAction({ action: "click", id: 1 }, [el(1, label)], URL1);
    expect(r.level).toBe("high");
    expect(r.category).toBe(category);
    expect(r.key).toContain(category);
  });

  it("leaves ordinary navigation and shopping steps alone", () => {
    for (const label of ["Add to cart", "Posts", "Search", "Next page", "View details", "Share", "Comments (12)"]) {
      expect(assessAction({ action: "click", id: 1 }, [el(1, label)], URL1).level, label).not.toBe("high");
    }
  });

  it("ignores long link text that merely mentions a risky word", () => {
    const headline = "Why you should never delete your browser history without reading this guide to privacy and safety";
    expect(assessAction({ action: "click", id: 1 }, [el(1, headline, { tag: "a" })], URL1).level).toBe("low");
  });

  it("treats a generic OK as risky only when the dialog names the consequence", () => {
    const risky = assessAction({ action: "click", id: 1 }, [el(1, "OK", { ctx: "Delete this file permanently? This cannot be undone.", flags: ["in-dialog"] })], URL1);
    expect(risky).toMatchObject({ level: "high", category: "destructive" });
    expect(assessAction({ action: "click", id: 1 }, [el(1, "OK", { ctx: "Cookies help us improve the site", flags: ["in-dialog"] })], URL1).level).toBe("low");
    expect(assessAction({ action: "click", id: 1 }, [el(1, "OK")], URL1).level).toBe("low");
  });

  it("resolves a coordinate click to the element under it, so x/y can't dodge the gate", () => {
    const els = [el(1, "Cancel", { x: 100, y: 50, w: 80, h: 30 }), el(2, "Place order", { x: 300, y: 50, w: 120, h: 40 })];
    expect(assessAction({ action: "click", x: 310, y: 55 }, els, URL1).level).toBe("high");
    expect(assessAction({ action: "click", x: 100, y: 50 }, els, URL1).level).not.toBe("high");
  });

  it("gates submitting typed text and Enter on the control last touched", () => {
    const send = el(5, "Send a message", { tag: "textarea" });
    expect(assessAction({ action: "type", id: 5, submit: true }, [send], URL1).level).toBe("high");
    expect(assessAction({ action: "type", id: 5, submit: false }, [send], URL1).level).toBe("low");
    expect(assessAction({ action: "press", key: "Enter" }, [], URL1, el(6, "Place order")).level).toBe("high");
    expect(assessAction({ action: "press", key: "Enter" }, [], URL1, el(7, "Search", { tag: "input" })).level).toBe("low");
    expect(assessAction({ action: "press", key: "Escape" }, [], URL1, el(6, "Place order")).level).toBe("low");
  });

  it("does not gate read-only actions", () => {
    for (const action of ["scroll", "goto", "search", "wait", "screenshot", "switch_tab", "back"]) {
      expect(assessAction({ action }, [el(1, "Place order")], URL1).level, action).toBe("low");
    }
  });

  it("notes password fields and form actions as medium (logged, not blocked)", () => {
    expect(assessAction({ action: "type", id: 1, submit: false }, [el(1, "", { tag: "input", type: "password" })], URL1).level).toBe("low");
    expect(assessAction({ action: "type", id: 1, submit: true }, [el(1, "Password", { tag: "input", type: "password" })], URL1).level).toBe("medium");
    expect(assessAction({ action: "click", id: 1 }, [el(1, "Log in")], URL1).level).toBe("medium");
  });

  it("makes the key specific to the action and page", () => {
    const a = assessAction({ action: "click", id: 1 }, [el(1, "Place order")], "https://a.example.com/pay?x=1");
    const same = assessAction({ action: "click", id: 9 }, [el(9, "place  order")], "https://a.example.com/pay?x=2");
    const other = assessAction({ action: "click", id: 1 }, [el(1, "Place order")], "https://b.example.com/pay");
    expect(a.key).toBe(same.key);
    expect(a.key).not.toBe(other.key);
  });
});

describe("approvals", () => {
  beforeEach(() => resetApprovals());
  const req = { key: "financial|place order|shop.example.com/cart", summary: "Click “Place order”", category: "financial" as const, reasons: ["button text"], url: URL1 };

  it("blocks until approved, then allows exactly once", () => {
    requestApproval("c1", req);
    expect(consumeApproval("c1", req.key)).toBe(false);
    expect(grantApproval("c1", req.key)).toBe(true);
    expect(consumeApproval("c1", req.key)).toBe(true);
    expect(consumeApproval("c1", req.key)).toBe(false);
  });

  it("only approves the action actually pending", () => {
    requestApproval("c1", req);
    expect(grantApproval("c1", "financial|something else|elsewhere")).toBe(false);
    expect(consumeApproval("c1", "financial|something else|elsewhere")).toBe(false);
    expect(getPendingApproval("c1")?.key).toBe(req.key);
  });

  it("does not let one chat's approval unlock another's", () => {
    requestApproval("c1", req);
    grantApproval("c1", req.key);
    expect(consumeApproval("c2", req.key)).toBe(false);
  });

  it("expires an unused approval", () => {
    requestApproval("c1", req, 0);
    grantApproval("c1", req.key, 0);
    expect(consumeApproval("c1", req.key, req.summary, "financial", 11 * 60_000)).toBe(false);
    expect(auditLog("c1").at(-1)?.decision).toBe("expired");
  });

  it("a denial clears the request and cannot later be consumed", () => {
    requestApproval("c1", req);
    expect(denyApproval("c1", req.key)).toBe(true);
    expect(getPendingApproval("c1")).toBeUndefined();
    expect(consumeApproval("c1", req.key)).toBe(false);
  });

  it("records an audit trail of every decision", () => {
    requestApproval("c1", req);
    grantApproval("c1", req.key);
    consumeApproval("c1", req.key, req.summary, "financial");
    expect(auditLog("c1").map((e) => e.decision)).toEqual(["requested", "approved", "executed"]);
  });
});
