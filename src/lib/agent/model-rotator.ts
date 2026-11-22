// Task-local automatic model rotation for long-running browser agent tasks.
//
// Tracks per-model step counts and consecutive unproductive steps. When a model stalls,
// repeatedly fails/loops, or reaches its per-model turn share on a long task, rotates to
// another available model automatically (while preserving full task state and progress).

export interface ModelRotationConfig {
  /** Consecutive failed or zero-effect actions before rotating to another model. */
  maxConsecutiveFailures: number;
  /** Maximum turns a single model runs before rotating to a fresh model on long tasks. */
  maxTurnsPerModel: number;
}

const DEFAULTS: ModelRotationConfig = {
  maxConsecutiveFailures: 3,
  maxTurnsPerModel: 18,
};

export interface RotationDecision {
  rotated: boolean;
  reason?: string;
  excludedModel?: string;
}

export class ModelRotator {
  private readonly cfg: ModelRotationConfig;
  private turnsByModel = new Map<string, number>();
  private consecutiveBad = new Map<string, number>();
  private excluded: string[] = [];

  constructor(cfg: Partial<ModelRotationConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /** Models currently rotated out for this task. */
  get excludedModels(): string[] {
    return [...this.excluded];
  }

  /**
   * Record the outcome of one agent step on `model`.
   * Returns `{ rotated: true, reason }` when the task should switch to a different model.
   */
  recordStep(model: string | undefined, ok: boolean, hadEffect: boolean, madeProgress = false): RotationDecision {
    const m = (model || "").trim();
    if (!m) return { rotated: false };

    const turns = (this.turnsByModel.get(m) ?? 0) + 1;
    this.turnsByModel.set(m, turns);

    if (ok && (hadEffect || madeProgress)) {
      this.consecutiveBad.set(m, 0);
    } else {
      const bad = (this.consecutiveBad.get(m) ?? 0) + 1;
      this.consecutiveBad.set(m, bad);
      if (bad >= this.cfg.maxConsecutiveFailures) {
        this.exclude(m);
        this.consecutiveBad.set(m, 0);
        return {
          rotated: true,
          excludedModel: m,
          reason: `${m} had ${bad} consecutive unproductive steps; switching to another available model`,
        };
      }
    }

    if (turns >= this.cfg.maxTurnsPerModel && !madeProgress) {
      this.exclude(m);
      this.turnsByModel.set(m, 0);
      return {
        rotated: true,
        excludedModel: m,
        reason: `${m} reached ${turns} turns on this task; rotating to a fresh model`,
      };
    }

    return { rotated: false };
  }

  /** Force-rotate away from a model (e.g. on loop warning or persistent stall). */
  rotateFrom(model: string | undefined, reason: string): RotationDecision {
    const m = (model || "").trim();
    if (!m) return { rotated: false };
    this.exclude(m);
    this.consecutiveBad.set(m, 0);
    this.turnsByModel.set(m, 0);
    return { rotated: true, excludedModel: m, reason };
  }

  /**
   * If all configured models have been excluded (e.g., on a single-model setup), clear the
   * exclusion list so the task can continue rather than failing with "no models available".
   */
  resetIfExhausted() {
    if (this.excluded.length > 0) this.excluded = [];
  }

  private exclude(model: string) {
    if (!this.excluded.includes(model)) this.excluded.push(model);
  }
}
