import { describe, expect, it } from "vitest";
import { describeRequirements, requirementsComplete, reviewRequirements, taskRequirements, updateRequirements } from "@/lib/agent/requirements";

describe("task requirement verification", () => {
  const goal = "Open the editor, add three curves, make the second green, and leave it open. Report all three equations.";
  it("keeps the complete original request even when planning omits constraints", () => {
    const items = taskRequirements(goal, ["Open the editor", "Add curves"]);
    expect(items[0].text).toBe(goal); expect(items).toHaveLength(3);
    expect(describeRequirements(items)).toContain("Report all three equations");
  });
  it("rejects completion when a requirement is omitted, duplicated or lacks evidence", () => {
    const items = taskRequirements(goal, ["Three curves", "Second green", "Equations in answer"]);
    const rows = items.map(r => ({ id: r.id, status: "verified", evidence: "Observed in editor and answer" }));
    expect(requirementsComplete(reviewRequirements(items, rows))).toBe(true);
    expect(requirementsComplete(reviewRequirements(items, rows.slice(0, -1)))).toBe(false);
    expect(requirementsComplete(reviewRequirements(items, [...rows, rows[1]]))).toBe(false);
    expect(requirementsComplete(reviewRequirements(items, rows.map(r => ({ ...r, evidence: "" }))))).toBe(false);
  });
  it("preserves every requirement and explicit blockers for resume", () => {
    const items = taskRequirements(goal, ["Editor access"]);
    const reviewed = reviewRequirements(items, [{ id: "r1", status: "blocked", evidence: "Editor displays sign-in required" }, { id: "invented", status: "verified", evidence: "fake" }]);
    expect(reviewed).toHaveLength(2); expect(reviewed[1].status).toBe("blocked");
    expect(requirementsComplete(reviewed)).toBe(false);
  });
  it("tracks individual progress without certifying the complete goal before the final audit", () => {
    const items = taskRequirements(goal, ["Three curves", "Second green"]);
    const updated = updateRequirements(items, [{ id: "r0", status: "verified", evidence: "claim" }, { id: "r1", status: "verified", evidence: "Three expression rows visible" }]);
    expect(updated[0].status).toBe("pending"); expect(updated[1].status).toBe("verified"); expect(updated[2].status).toBe("pending");
  });
});
