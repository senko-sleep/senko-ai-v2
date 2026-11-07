import { Loader2, ShieldAlert } from "lucide-react";
import type { ApprovalInfo } from "./lib";

const CATEGORY_LABEL: Record<ApprovalInfo["category"], string> = {
  financial: "Financial",
  destructive: "Destructive",
  security: "Security",
  external: "Sends something outward",
  none: "Consequential",
};

/**
 * Shown when the agent has stopped before a consequential action. It names the exact action and
 * page; nothing has been done yet. Approving covers that single action once.
 */
export function ApprovalBar({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: ApprovalInfo;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="sk-approval-title"
      aria-describedby="sk-approval-desc"
      className="sk-verification-banner sk-in mb-2 rounded-xl px-3 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[var(--sk-accent-ink)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div id="sk-approval-title" className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-[var(--sk-text)]">
            Approval needed
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-[var(--sk-accent-ink)]">
              {CATEGORY_LABEL[approval.category]}
            </span>
          </div>
          <p id="sk-approval-desc" className="mt-0.5 break-words text-[12px] text-[var(--sk-text)]">
            {approval.summary}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--sk-muted)]">
            Nothing has been done yet. Flagged because of {approval.reasons.join(", ") || "its effect"}. Approving allows this one action.
          </p>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          className="sk-btn h-7 rounded-md border border-[var(--sk-line-strong)] px-2.5 text-[11.5px] text-[var(--sk-text)] disabled:opacity-50"
        >
          Don&apos;t do it
        </button>
        <button type="button" onClick={onApprove} disabled={busy} className="sk-btn sk-primary h-7 rounded-md px-3 text-[11.5px] font-semibold disabled:opacity-60">
          {busy ? <Loader2 size={11} className="sk-spin" aria-hidden /> : null}
          Approve this action
        </button>
      </div>
    </div>
  );
}
