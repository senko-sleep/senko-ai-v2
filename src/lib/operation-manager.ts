/**
 * Operation State Machine
 * 
 * Replaces the boolean `isStreaming` + single shared `abortRef` pattern.
 * Each concurrent operation gets its own AbortController.
 * Exposes deterministic phase transitions for the status UI.
 */

export type OpPhase = "idle" | "searching" | "scraping" | "browsing" | "reading" | "generating" | "error";

export interface Operation {
  id: string;
  phase: OpPhase;
  label: string;
  abort: AbortController;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

// Priority order: highest-priority phase wins when multiple ops are active
const PHASE_PRIORITY: Record<OpPhase, number> = {
  error: 6,
  searching: 5,
  scraping: 4,
  browsing: 3,
  reading: 2,
  generating: 1,
  idle: 0,
};

const STALL_TIMEOUT_MS = 60_000;

export type OpListener = (phase: OpPhase, operations: Operation[]) => void;

export class OperationManager {
  private operations: Map<string, Operation> = new Map();
  private listeners: Set<OpListener> = new Set();
  private stallTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private idCounter = 0;

  private generateId(): string {
    this.idCounter++;
    return `op_${Date.now().toString(36)}_${this.idCounter}`;
  }

  /** Start a new operation. Returns { id, signal } for use with fetch/streams. */
  startOp(phase: OpPhase, label: string): { id: string; signal: AbortSignal } {
    const id = this.generateId();
    const abort = new AbortController();
    const op: Operation = { id, phase, label, abort, startedAt: Date.now() };
    this.operations.set(id, op);

    // Stall detection: auto-abort if no progress for 60s
    this.resetStallTimer(id);

    this.notify();
    return { id, signal: abort.signal };
  }

  /** Mark an operation as complete and remove it. */
  completeOp(id: string): void {
    const op = this.operations.get(id);
    if (!op) return;
    this.clearStallTimer(id);
    this.operations.delete(id);
    this.notify();
  }

  /** Mark an operation as failed. Removes it after notification. */
  failOp(id: string, error?: string): void {
    const op = this.operations.get(id);
    if (!op) return;
    this.clearStallTimer(id);
    op.error = error || "Unknown error";
    op.phase = "error";
    op.completedAt = Date.now();
    // Remove after a short delay so listeners can see the error state
    this.operations.delete(id);
    this.notify();
  }

  /** Abort all active operations. Called by Stop button. */
  abortAll(): void {
    for (const [id, op] of this.operations) {
      this.clearStallTimer(id);
      try { op.abort.abort(); } catch { /* already aborted */ }
    }
    this.operations.clear();
    this.notify();
  }

  /** Abort a specific operation by ID. */
  abortOp(id: string): void {
    const op = this.operations.get(id);
    if (!op) return;
    this.clearStallTimer(id);
    try { op.abort.abort(); } catch { /* already aborted */ }
    this.operations.delete(id);
    this.notify();
  }

  /** Reset the stall timer for an operation (call when progress is made). */
  touchOp(id: string): void {
    if (!this.operations.has(id)) return;
    this.resetStallTimer(id);
  }

  /** Update the label of an active operation (e.g., "Searching..." → "Reading sources..."). */
  updateLabel(id: string, label: string): void {
    const op = this.operations.get(id);
    if (!op) return;
    op.label = label;
    this.notify();
  }

  /** Update the phase of an active operation (e.g., searching → reading). */
  updatePhase(id: string, phase: OpPhase): void {
    const op = this.operations.get(id);
    if (!op) return;
    op.phase = phase;
    this.notify();
  }

  /** Get the current highest-priority phase across all active operations. */
  get currentPhase(): OpPhase {
    if (this.operations.size === 0) return "idle";
    let highest: OpPhase = "idle";
    for (const op of this.operations.values()) {
      if (PHASE_PRIORITY[op.phase] > PHASE_PRIORITY[highest]) {
        highest = op.phase;
      }
    }
    return highest;
  }

  /** Get all active operations as an array. */
  get activeOps(): Operation[] {
    return Array.from(this.operations.values());
  }

  /** Whether any operation is currently active. */
  get isActive(): boolean {
    return this.operations.size > 0;
  }

  /** Subscribe to phase changes. Returns unsubscribe function. */
  subscribe(listener: OpListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const phase = this.currentPhase;
    const ops = this.activeOps;
    for (const listener of this.listeners) {
      try { listener(phase, ops); } catch { /* listener error shouldn't break manager */ }
    }
  }

  private resetStallTimer(id: string): void {
    this.clearStallTimer(id);
    const timer = setTimeout(() => {
      const op = this.operations.get(id);
      if (op) {
        console.warn(`[OperationManager] Stall detected for op ${id} (${op.label}), auto-aborting after ${STALL_TIMEOUT_MS}ms`);
        this.abortOp(id);
      }
    }, STALL_TIMEOUT_MS);
    this.stallTimers.set(id, timer);
  }

  private clearStallTimer(id: string): void {
    const timer = this.stallTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.stallTimers.delete(id);
    }
  }

  /** Cleanup all timers. Call on unmount. */
  destroy(): void {
    this.abortAll();
    for (const timer of this.stallTimers.values()) {
      clearTimeout(timer);
    }
    this.stallTimers.clear();
    this.listeners.clear();
  }
}

// Singleton for the app
let _instance: OperationManager | null = null;

export function getOperationManager(): OperationManager {
  if (!_instance) {
    _instance = new OperationManager();
  }
  return _instance;
}
