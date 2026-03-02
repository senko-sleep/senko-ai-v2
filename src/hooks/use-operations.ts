"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { OperationManager, getOperationManager, type OpPhase, type Operation } from "@/lib/operation-manager";

/**
 * React hook for the operation state machine.
 * Replaces isStreaming + abortRef + startActivity/completeActivity.
 */
export function useOperations() {
  const managerRef = useRef<OperationManager>(getOperationManager());
  const [phase, setPhase] = useState<OpPhase>("idle");
  const [operations, setOperations] = useState<Operation[]>([]);

  useEffect(() => {
    const mgr = managerRef.current;
    const unsub = mgr.subscribe((newPhase, newOps) => {
      setPhase(newPhase);
      setOperations([...newOps]);
    });
    return unsub;
  }, []);

  const startOp = useCallback((opPhase: OpPhase, label: string) => {
    return managerRef.current.startOp(opPhase, label);
  }, []);

  const completeOp = useCallback((id: string) => {
    managerRef.current.completeOp(id);
  }, []);

  const failOp = useCallback((id: string, error?: string) => {
    managerRef.current.failOp(id, error);
  }, []);

  const abortAll = useCallback(() => {
    managerRef.current.abortAll();
  }, []);

  const abortOp = useCallback((id: string) => {
    managerRef.current.abortOp(id);
  }, []);

  const touchOp = useCallback((id: string) => {
    managerRef.current.touchOp(id);
  }, []);

  const updateLabel = useCallback((id: string, label: string) => {
    managerRef.current.updateLabel(id, label);
  }, []);

  const updatePhase = useCallback((id: string, newPhase: OpPhase) => {
    managerRef.current.updatePhase(id, newPhase);
  }, []);

  return {
    /** Current highest-priority phase across all operations */
    phase,
    /** All active operations */
    operations,
    /** Whether any operation is active (replaces isStreaming) */
    isActive: phase !== "idle",
    /** Start a new operation — returns { id, signal } */
    startOp,
    /** Complete an operation by ID */
    completeOp,
    /** Fail an operation by ID */
    failOp,
    /** Abort all operations (Stop button) */
    abortAll,
    /** Abort a specific operation */
    abortOp,
    /** Reset stall timer (call on stream chunk received) */
    touchOp,
    /** Update an operation's label */
    updateLabel,
    /** Update an operation's phase */
    updatePhase,
  };
}
