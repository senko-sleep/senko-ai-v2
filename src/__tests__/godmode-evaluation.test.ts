import { beforeEach, describe, expect, it } from "vitest";
import { formatAccessibilitySnapshot } from "@/lib/agent/interaction";
import { diagnoseFailure } from "@/lib/agent/recovery";
import {
  advanceWorkflowNode,
  classifyTaskIntent,
  createWorkflowGraph,
  evaluateBranchCondition,
  parallelizableBatch,
  readyNodes,
  resetWorkflowGraphs,
  verifyNodeCriteria,
} from "@/lib/agent/workflow-engine";
import {
  deleteSkill,
  findMatchingSkills,
  instantiateSkillNodes,
  listSkills,
  recordSkillReplayOutcome,
  resetSkills,
  saveVerifiedSkill,
} from "@/lib/agent/skills";
import { computeBenchmarkReport, percentile, runEvaluationSuite } from "@/lib/agent/benchmark";

describe("Accessibility Tree Snapshot Formatting", () => {
  it("formats semantic ARIA roles, agent IDs, values, and state flags with hierarchy indentation", () => {
    const out = formatAccessibilitySnapshot([
      { role: "main", name: "Workspace", depth: 0 },
      { role: "combobox", name: "Environment", depth: 1, agentId: 7, value: "Production", states: ["expanded"] },
      { role: "option", name: "Staging", depth: 2, agentId: 12, states: ["selected"] },
    ]);
    expect(out).toContain('- main "Workspace"');
    expect(out).toContain('  - combobox [7] "Environment" value="Production" (expanded)');
    expect(out).toContain('    - option [12] "Staging" (selected)');
  });

  it("handles an empty accessibility tree gracefully", () => {
    expect(formatAccessibilitySnapshot([])).toBe("(empty accessibility tree)");
  });
});

describe("Typed Failure Diagnosis & Recovery Router", () => {
  it("returns null when an action succeeded with visible effect", () => {
    expect(
      diagnoseFailure({
        action: "click",
        ok: true,
        hadEffect: true,
        resultText: 'Clicked "Continue"',
      }),
    ).toBeNull();
  });

  it("routes bot verification challenges to handoff_user without attaching unnecessary DOM dumps", () => {
    const diag = diagnoseFailure({
      action: "goto",
      ok: false,
      hadEffect: false,
      resultText: "Verification required on example.com: verify you are human",
      challengeDetected: true,
    });
    expect(diag?.kind).toBe("verification_wall");
    expect(diag?.strategy).toBe("handoff_user");
    expect(diag?.attachAccessibilityTree).toBe(false);
  });

  it("routes occluded controls to dismiss_overlay and requests an ARIA tree refresh", () => {
    const diag = diagnoseFailure({
      action: "click",
      ok: false,
      hadEffect: false,
      resultText: 'It is covered by div#consent-modal "Accept cookies".',
      coveredBy: 'div#consent-modal "Accept cookies"',
    });
    expect(diag?.kind).toBe("covered_by_overlay");
    expect(diag?.strategy).toBe("dismiss_overlay");
    expect(diag?.attachAccessibilityTree).toBe(true);
  });

  it("routes missing/hidden controls to reobserve_a11y", () => {
    const diag = diagnoseFailure({
      action: "click",
      ok: false,
      hadEffect: false,
      resultText: "That element isn't on the page anymore.",
      elementFound: false,
    });
    expect(diag?.kind).toBe("missing_element");
    expect(diag?.strategy).toBe("reobserve_a11y");
    expect(diag?.attachAccessibilityTree).toBe(true);
  });

  it("routes HTTP/network failures to alternate_route", () => {
    const diag = diagnoseFailure({
      action: "goto",
      ok: false,
      hadEffect: false,
      resultText: "Loaded api.example.com but the server answered HTTP 503",
    });
    expect(diag?.kind).toBe("navigation_error");
    expect(diag?.strategy).toBe("alternate_route");
  });

  it("routes zero-effect clicks to switch_click_method", () => {
    const diag = diagnoseFailure({
      action: "click",
      ok: true,
      hadEffect: false,
      resultText: 'Clicked "Submit" — but nothing visibly changed on the page',
    });
    expect(diag?.kind).toBe("no_effect");
    expect(diag?.strategy).toBe("switch_click_method");
    expect(diag?.attachAccessibilityTree).toBe(true);
  });

  it("routes repeated identical failures to replan (stagnation)", () => {
    const diag = diagnoseFailure({
      action: "click",
      ok: false,
      hadEffect: false,
      resultText: "Failed",
      repeatCount: 2,
    });
    expect(diag?.kind).toBe("stagnation");
    expect(diag?.strategy).toBe("replan");
  });
});

describe("Autonomous Workflow Engine (DAG, Conditional Branches, Parallel Batching, Anti-False-Success)", () => {
  beforeEach(() => {
    resetWorkflowGraphs();
  });

  it("classifies task intents accurately", () => {
    expect(classifyTaskIntent("Build a responsive TypeScript component")).toBe("coding");
    expect(classifyTaskIntent("Plot a regression chart from the CSV dataset")).toBe("data");
    expect(classifyTaskIntent("Navigate to settings and click the export button")).toBe("automation");
    expect(classifyTaskIntent("Research and compare latency benchmarks with citations")).toBe("research");
  });

  it("rejects tool-call-only completion when post-action verification evidence is missing", () => {
    const graph = createWorkflowGraph("task_1", "Submit deployment form", [
      {
        id: "deploy",
        title: "Click Deploy",
        dependsOn: [],
        risk: "medium",
        verification: [{ id: "v1", kind: "text_contains", expected: "Deployment live" }],
      },
    ]);

    const premature = verifyNodeCriteria(graph.nodes[0], { toolSucceededOnly: true });
    expect(premature.verified).toBe(false);
    expect(premature.summary).toContain("tool call completion alone does not prove task outcome");

    const step = advanceWorkflowNode(graph, "deploy", { text: "Status: Deployment live on production" });
    expect(step.verified).toBe(true);
    expect(graph.stage).toBe("delivery");
  });

  it("batches parallel read-only low-risk nodes while isolating mutating nodes", () => {
    const graph = createWorkflowGraph("task_2", "Compare two documentation sources", [
      {
        id: "fetch_a",
        title: "Read docs A",
        dependsOn: [],
        readOnly: true,
        risk: "low",
        verification: [{ id: "va", kind: "url_matches", expected: "docs.a.example" }],
      },
      {
        id: "fetch_b",
        title: "Read docs B",
        dependsOn: [],
        readOnly: true,
        risk: "low",
        verification: [{ id: "vb", kind: "url_matches", expected: "docs.b.example" }],
      },
      {
        id: "write_report",
        title: "Generate synthesis report",
        dependsOn: ["fetch_a", "fetch_b"],
        readOnly: false,
        risk: "low",
        verification: [{ id: "vr", kind: "artifact_non_empty", expected: "# Comparison" }],
      },
    ]);

    const firstBatch = parallelizableBatch(graph);
    expect(firstBatch.map((n) => n.id)).toEqual(["fetch_a", "fetch_b"]);

    advanceWorkflowNode(graph, "fetch_a", { url: "https://docs.a.example/guide" });
    advanceWorkflowNode(graph, "fetch_b", { url: "https://docs.b.example/reference" });

    const secondBatch = parallelizableBatch(graph);
    expect(secondBatch.map((n) => n.id)).toEqual(["write_report"]);
  });

  it("evaluates conditional recovery branches when a primary node fails", () => {
    const graph = createWorkflowGraph("task_3", "Open dashboard and handle login redirect", [
      {
        id: "open_dash",
        title: "Open dashboard",
        dependsOn: [],
        risk: "low",
        verification: [{ id: "v_dash", kind: "text_contains", expected: "Analytics Overview" }],
      },
      {
        id: "handle_banner",
        title: "Dismiss announcement modal if dashboard text is missing",
        dependsOn: ["open_dash"],
        condition: "if_failed:open_dash",
        risk: "low",
        verification: [{ id: "v_modal", kind: "text_contains", expected: "Modal dismissed" }],
      },
    ]);

    // Primary node fails verification
    const firstTry = advanceWorkflowNode(graph, "open_dash", { text: "Welcome Announcement Modal" });
    expect(firstTry.verified).toBe(false);
    expect(graph.stage).toBe("recovery");

    // Recovery branch is now ready
    const ready = readyNodes(graph);
    expect(ready.map((n) => n.id)).toEqual(["handle_banner"]);

    // Verify evaluateBranchCondition directly for url_contains and text_contains
    expect(evaluateBranchCondition("url_contains:checkout", { url: "https://shop.example/checkout" })).toBe(true);
    expect(evaluateBranchCondition("text_contains:out of stock", { text: "In stock and ready" })).toBe(false);
  });
});

describe("Verified Skill / Workflow Library", () => {
  beforeEach(() => {
    resetWorkflowGraphs();
    resetSkills();
  });

  it("refuses to save a workflow whose verification criteria have not all passed", () => {
    const graph = createWorkflowGraph("unverified_task", "Export monthly invoices", [
      {
        id: "step_1",
        title: "Open billing page",
        dependsOn: [],
        risk: "low",
        verification: [{ id: "v1", kind: "url_matches", expected: "/billing" }],
      },
    ]);
    expect(saveVerifiedSkill("user_1", graph)).toBeNull();
  });

  it("saves a verified workflow, labels reuse transparently, and auto-demotes on replay failures", () => {
    const graph = createWorkflowGraph("verified_task", "Export monthly engineering metrics table", [
      {
        id: "step_1",
        title: "Open metrics dashboard",
        dependsOn: [],
        risk: "low",
        verification: [{ id: "v1", kind: "url_matches", expected: "metrics.example.com" }],
      },
    ]);
    advanceWorkflowNode(graph, "step_1", { url: "https://metrics.example.com/monthly" });

    const skill = saveVerifiedSkill("user_1", graph, {
      title: "Export Monthly Engineering Metrics",
      domain: "metrics.example.com",
    });
    expect(skill).not.toBeNull();
    expect(skill?.disclosureLabel).toBe("Reused saved workflow: Export Monthly Engineering Metrics");

    const matches = findMatchingSkills("user_1", "Export monthly engineering metrics table", "metrics.example.com");
    expect(matches).toHaveLength(1);
    expect(instantiateSkillNodes(matches[0])).toHaveLength(1);

    // Simulate two failed replays -> skill is automatically demoted (active = false)
    recordSkillReplayOutcome("user_1", skill!.id, false);
    const afterSecondFail = recordSkillReplayOutcome("user_1", skill!.id, false);
    expect(afterSecondFail?.active).toBe(false);
    expect(findMatchingSkills("user_1", "Export monthly engineering metrics table")).toHaveLength(0);

    // User can delete the saved workflow
    expect(deleteSkill("user_1", skill!.id)).toBe(true);
    expect(listSkills("user_1")).toHaveLength(0);
  });
});

describe("GODMODE End-to-End Evaluation Suite & Benchmark Harness", () => {
  it("executes all 9 evaluation scenarios with 100% verified completion, 100% recovery, and 0% false-success rate", () => {
    const report = runEvaluationSuite();
    expect(report.totalScenarios).toBe(9);
    expect(report.taskCompletionRate).toBe(1);
    expect(report.recoverySuccessRate).toBe(1);
    expect(report.falseSuccessRate).toBe(0);
    expect(report.visualControlAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.interactionLatencyP50Ms).toBeGreaterThan(0);
    expect(report.interactionLatencyP95Ms).toBeGreaterThanOrEqual(report.interactionLatencyP50Ms);
  });

  it("flags false-success runs when completion is claimed without passing verification", () => {
    const customReport = computeBenchmarkReport([
      {
        scenarioId: "bad_run",
        title: "Premature completion claim",
        interactionLatencyMs: 25,
        phaseLatenciesMs: { acting: 20, verifying: 5 },
        visualActionsAttempted: 1,
        visualActionsFirstTryHit: 0,
        claimedDone: true,
        verificationPassed: false,
        modelCalls: 1,
        tokensUsed: 500,
        evidenceSummary: "Verification failed",
      },
    ]);
    expect(customReport.falseSuccessRate).toBe(1);
    expect(customReport.taskCompletionRate).toBe(0);
    expect(percentile([10, 20, 30, 40, 100], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 100], 95)).toBe(100);
  });
});
