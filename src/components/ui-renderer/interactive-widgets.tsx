"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  XCircle,
} from "lucide-react";
import type { UIAction, UIQuestionField, UIQuizQuestion, UIValue } from "@/lib/ui-schema";

const FORM_STORAGE_PREFIX = "senko.ui_form.";

export function QuestionnaireWidget({
  id,
  messageId,
  title,
  description,
  badge,
  fields,
  submitLabel = "Submit to Senko",
  promptPrefix,
  onSendMessage,
  onStateChange,
}: {
  id?: string;
  messageId?: string;
  title: string;
  description?: string;
  badge?: string;
  fields: UIQuestionField[];
  submitLabel?: string;
  promptPrefix?: string;
  onSendMessage?: (text: string) => void;
  onStateChange?: (key: string, value: UIValue) => void;
}) {
  const storageKey = `${FORM_STORAGE_PREFIX}${messageId || "msg"}_${id || title.replace(/\s+/g, "_")}`;

  const [values, setValues] = useState<Record<string, UIValue>>(() => {
    const initial: Record<string, UIValue> = {};
    for (const f of fields) {
      if (f.defaultValue !== undefined) {
        initial[f.id] = f.defaultValue;
      } else if (f.type === "multi_choice") {
        initial[f.id] = [];
      } else if (f.type === "slider") {
        initial[f.id] = f.min ?? 50;
      } else if (f.type === "toggle") {
        initial[f.id] = false;
      } else if (f.type === "rating") {
        initial[f.id] = 0;
      } else if (f.type === "select" && f.options?.[0]) {
        initial[f.id] = f.options[0].value;
      } else {
        initial[f.id] = "";
      }
    }
    return initial;
  });

  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { values?: Record<string, UIValue>; submitted?: boolean };
        if (parsed.values) setValues((prev) => ({ ...prev, ...parsed.values }));
        if (parsed.submitted) setSubmitted(true);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const setField = (fieldId: string, val: UIValue) => {
    setValues((prev) => {
      const next = { ...prev, [fieldId]: val };
      try {
        localStorage.setItem(storageKey, JSON.stringify({ values: next, submitted: false }));
      } catch {
        /* ignore */
      }
      return next;
    });
    setSubmitted(false);
    onStateChange?.(fieldId, val);
  };

  const toggleMulti = (fieldId: string, optVal: string) => {
    const current = Array.isArray(values[fieldId]) ? (values[fieldId] as string[]) : [];
    const next = current.includes(optVal) ? current.filter((x) => x !== optVal) : [...current, optVal];
    setField(fieldId, next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lines: string[] = [];
    for (const f of fields) {
      const rawVal = values[f.id];
      let formatted = "";
      if (Array.isArray(rawVal)) {
        const labels = rawVal.map((v) => f.options?.find((o) => o.value === v)?.label || v);
        formatted = labels.length ? labels.join(", ") : "None selected";
      } else if (typeof rawVal === "boolean") {
        formatted = rawVal ? "Yes" : "No";
      } else if (f.type === "slider" && f.unit) {
        formatted = `${rawVal}${f.unit}`;
      } else if (f.type === "rating") {
        formatted = rawVal ? `${rawVal} / ${f.max || 5}` : "Not rated";
      } else {
        const matchLabel = f.options?.find((o) => o.value === String(rawVal))?.label;
        formatted = String(matchLabel ?? rawVal ?? "").trim() || "Not specified";
      }
      lines.push(`- **${f.label}**: ${formatted}`);
    }

    const header = promptPrefix || `Here are my answers for **${title}**:`;
    const payload = `${header}\n${lines.join("\n")}`;

    setSubmitted(true);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ values, submitted: true }));
    } catch {
      /* ignore */
    }
    onSendMessage?.(payload);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="my-3 overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-4 sm:p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h4 className="text-[15px] font-semibold text-[var(--sk-text)]">{title}</h4>
          {description && <p className="mt-0.5 text-[12.5px] text-[var(--sk-muted)]">{description}</p>}
        </div>
        {badge && (
          <span className="shrink-0 rounded-full border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--sk-accent-ink)]">
            {badge}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {fields.map((field) => {
          const val = values[field.id];
          return (
            <div key={field.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[13px] font-medium text-[var(--sk-text)]">
                  {field.label}
                  {field.required && <span className="ml-1 text-[var(--sk-accent-ink)]">*</span>}
                </label>
                {field.type === "slider" && (
                  <span className="rounded-md bg-[var(--sk-accent-soft)] px-2 py-0.5 font-mono text-[12px] font-semibold text-[var(--sk-accent-ink)]">
                    {String(val ?? field.min ?? 0)}
                    {field.unit || ""}
                  </span>
                )}
              </div>
              {field.description && <p className="text-[11.5px] text-[var(--sk-muted)]">{field.description}</p>}

              {/* Single Choice */}
              {field.type === "single_choice" && field.options && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {field.options.map((opt) => {
                    const active = String(val) === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setField(field.id, opt.value)}
                        aria-pressed={active}
                        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-[12.5px] transition ${
                          active
                            ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-text)] shadow-[0_0_14px_-4px_rgba(242,106,14,0.35)]"
                            : "border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-muted)] hover:border-[var(--sk-accent-line)] hover:text-[var(--sk-text)]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            active
                              ? "border-[var(--sk-accent)] bg-[var(--sk-accent)] text-white"
                              : "border-[var(--sk-faint)]"
                          }`}
                        >
                          {active && <Check size={10} strokeWidth={3} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[var(--sk-text)]">{opt.label}</div>
                          {opt.description && (
                            <div className="mt-0.5 text-[11px] text-[var(--sk-muted)]">{opt.description}</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Multi Choice */}
              {field.type === "multi_choice" && field.options && (
                <div className="flex flex-wrap gap-2">
                  {field.options.map((opt) => {
                    const list = Array.isArray(val) ? val : [];
                    const active = list.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleMulti(field.id, opt.value)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] transition ${
                          active
                            ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] font-medium text-[var(--sk-text)]"
                            : "border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-muted)] hover:border-[var(--sk-accent-line)] hover:text-[var(--sk-text)]"
                        }`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                            active ? "border-[var(--sk-accent)] bg-[var(--sk-accent)] text-white" : "border-[var(--sk-faint)]"
                          }`}
                        >
                          {active && <Check size={9} strokeWidth={3} />}
                        </span>
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Slider */}
              {field.type === "slider" && (
                <div className="pt-1">
                  <input
                    type="range"
                    min={field.min ?? 0}
                    max={field.max ?? 100}
                    step={field.step ?? 1}
                    value={Number(val ?? field.min ?? 0)}
                    onChange={(e) => setField(field.id, Number(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[var(--sk-accent)]"
                  />
                  <div className="mt-1 flex justify-between font-mono text-[10.5px] text-[var(--sk-faint)]">
                    <span>
                      {field.min ?? 0}
                      {field.unit || ""}
                    </span>
                    <span>
                      {field.max ?? 100}
                      {field.unit || ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Dropdown Select */}
              {field.type === "select" && field.options && (
                <select
                  value={String(val ?? "")}
                  onChange={(e) => setField(field.id, e.target.value)}
                  className="w-full rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)] px-3 py-2 text-[13px] text-[var(--sk-text)] outline-none focus:border-[var(--sk-accent)]"
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Text Input */}
              {field.type === "text" && (
                <input
                  type="text"
                  value={String(val ?? "")}
                  onChange={(e) => setField(field.id, e.target.value)}
                  placeholder={field.placeholder || "Type your answer…"}
                  className="w-full rounded-xl border border-[var(--sk-line)] bg-[var(--sk-raised)] px-3 py-2 text-[13px] text-[var(--sk-text)] outline-none placeholder:text-[var(--sk-faint)] focus:border-[var(--sk-accent)]"
                />
              )}

              {/* Textarea */}
              {field.type === "textarea" && (
                <textarea
                  rows={2}
                  value={String(val ?? "")}
                  onChange={(e) => setField(field.id, e.target.value)}
                  placeholder={field.placeholder || "Add details…"}
                  className="w-full resize-y rounded-xl border border-[var(--sk-line)] bg-[var(--sk-raised)] px-3 py-2 text-[13px] text-[var(--sk-text)] outline-none placeholder:text-[var(--sk-faint)] focus:border-[var(--sk-accent)]"
                />
              )}

              {/* Toggle Switch */}
              {field.type === "toggle" && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(val)}
                  onClick={() => setField(field.id, !val)}
                  className="inline-flex items-center gap-2.5 text-[12.5px] text-[var(--sk-text)]"
                >
                  <span className="sk-switch" aria-checked={Boolean(val)} />
                  <span className="text-[var(--sk-muted)]">{val ? "Enabled" : "Disabled"}</span>
                </button>
              )}

              {/* Rating Scale */}
              {field.type === "rating" && (
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: Math.min(10, Math.max(3, field.max || 5)) }, (_, i) => i + 1).map((star) => {
                    const active = Number(val || 0) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setField(field.id, star)}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                          active
                            ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                            : "border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
                        }`}
                        aria-label={`Rate ${star}`}
                      >
                        <Star size={14} fill={active ? "currentColor" : "none"} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sk-line)] pt-3.5">
        {submitted ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--sk-ok)]">
            <CheckCircle2 size={14} /> Submitted to conversation
          </span>
        ) : (
          <span className="text-[11.5px] text-[var(--sk-faint)]">
            Your selections will be sent directly to Senko
          </span>
        )}

        <button
          type="submit"
          disabled={!onSendMessage}
          className="sk-btn sk-primary h-8 rounded-xl px-4 text-[12.5px] font-semibold"
        >
          <Send size={12.5} />
          {submitted ? "Update & Resend" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function QuizWidget({
  title = "Interactive Practice",
  subtitle,
  questions,
  onSendMessage,
}: {
  title?: string;
  subtitle?: string;
  questions: UIQuizQuestion[];
  onSendMessage?: (text: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});

  const answeredCount = Object.keys(revealed).filter((k) => revealed[k]).length;
  const correctCount = questions.filter((q) => revealed[q.id] && selected[q.id] === q.correctOptionId).length;

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[15px] font-semibold text-[var(--sk-text)]">{title}</h4>
          {subtitle && <p className="mt-0.5 text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--sk-line)] bg-[var(--sk-raised)] px-2.5 py-0.5 font-mono text-[11.5px] text-[var(--sk-text)]">
            Score: {correctCount} / {questions.length}
          </span>
          {answeredCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelected({});
                setRevealed({});
                setShowHint({});
              }}
              className="sk-btn h-6.5 border border-[var(--sk-line)] px-2 text-[11px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {questions.map((q, qIdx) => {
          const picked = selected[q.id];
          const isChecked = Boolean(revealed[q.id]);
          const isCorrect = isChecked && picked === q.correctOptionId;

          return (
            <div key={q.id} className="rounded-xl border border-[var(--sk-line)] bg-white/[0.015] p-3.5">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="text-[13.5px] font-medium text-[var(--sk-text)]">
                  <span className="mr-1.5 font-mono text-[var(--sk-accent-ink)]">Q{qIdx + 1}.</span>
                  {q.question}
                </div>
                {q.difficulty && (
                  <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase text-[var(--sk-muted)]">
                    {q.difficulty}
                  </span>
                )}
              </div>

              {q.codeOrMath && (
                <pre className="my-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-[var(--sk-code-bg)] px-3 py-2 font-mono text-[12px] text-[var(--sk-text)]">
                  {q.codeOrMath}
                </pre>
              )}

              <div className="mt-2.5 space-y-1.5">
                {q.options.map((opt) => {
                  const isThisPicked = picked === opt.id;
                  const isThisCorrect = opt.id === q.correctOptionId;
                  let borderCls = "border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-muted)] hover:text-[var(--sk-text)]";
                  if (isChecked) {
                    if (isThisCorrect) {
                      borderCls = "border-emerald-500/50 bg-emerald-500/10 text-emerald-200";
                    } else if (isThisPicked) {
                      borderCls = "border-red-500/50 bg-red-500/10 text-red-200";
                    }
                  } else if (isThisPicked) {
                    borderCls = "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-text)]";
                  }

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSelected((s) => ({ ...s, [q.id]: opt.id }));
                        setRevealed((r) => ({ ...r, [q.id]: true }));
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] transition ${borderCls}`}
                    >
                      <span>{opt.label}</span>
                      {isChecked && isThisCorrect && <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />}
                      {isChecked && isThisPicked && !isThisCorrect && <XCircle size={14} className="shrink-0 text-red-400" />}
                    </button>
                  );
                })}
              </div>

              {/* Hint & Explanation */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                {q.hint && !isChecked && (
                  <button
                    type="button"
                    onClick={() => setShowHint((h) => ({ ...h, [q.id]: !h[q.id] }))}
                    className="inline-flex items-center gap-1 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-accent-ink)]"
                  >
                    <HelpCircle size={12} /> {showHint[q.id] ? "Hide hint" : "Need a hint?"}
                  </button>
                )}
              </div>

              {showHint[q.id] && !isChecked && q.hint && (
                <div className="mt-2 rounded-lg border border-[var(--sk-line)] bg-white/[0.03] px-3 py-2 text-[12px] text-[var(--sk-muted)]">
                  💡 {q.hint}
                </div>
              )}

              {isChecked && (
                <div
                  className={`mt-2.5 rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${
                    isCorrect
                      ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-100"
                      : "border-amber-500/30 bg-amber-500/[0.07] text-amber-100"
                  }`}
                >
                  <div className="font-semibold">{isCorrect ? "Correct!" : "Not quite."}</div>
                  {q.explanation && <div className="mt-0.5 opacity-90">{q.explanation}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {answeredCount === questions.length && onSendMessage && (
        <div className="mt-4 flex items-center justify-end border-t border-[var(--sk-line)] pt-3">
          <button
            type="button"
            onClick={() =>
              onSendMessage(
                `I finished the "${title}" practice quiz and scored ${correctCount}/${questions.length}. Can you review any tricky parts and give me the next level of questions?`
              )
            }
            className="sk-btn border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-3 py-1.5 text-[12px] text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-white"
          >
            <Sparkles size={12} /> Continue learning with Senko
          </button>
        </div>
      )}
    </div>
  );
}

export function InteractiveControlsWidget({
  title,
  description,
  stateKey = "control",
  controlType,
  options,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
  defaultValue,
  actions,
  state,
  onStateChange,
  onTriggerAction,
}: {
  title?: string;
  description?: string;
  stateKey?: string;
  controlType: "buttons" | "segmented" | "slider" | "select";
  options?: { label: string; value: string; description?: string; action?: UIAction }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue?: UIValue;
  actions?: UIAction[];
  state: Record<string, UIValue>;
  onStateChange: (key: string, val: UIValue) => void;
  onTriggerAction: (action: UIAction) => void;
}) {
  const currentVal = state[stateKey] ?? defaultValue ?? options?.[0]?.value ?? min;

  return (
    <div className="my-2.5 rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-3.5">
      {(title || description) && (
        <div className="mb-2.5">
          {title && <div className="text-[13px] font-semibold text-[var(--sk-text)]">{title}</div>}
          {description && <div className="text-[11.5px] text-[var(--sk-muted)]">{description}</div>}
        </div>
      )}

      {controlType === "segmented" && options && (
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)] p-1">
          {options.map((opt) => {
            const active = String(currentVal) === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onStateChange(stateKey, opt.value);
                  if (opt.action) onTriggerAction(opt.action);
                }}
                className={`rounded-lg px-3 py-1 text-[12px] font-medium transition ${
                  active
                    ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                    : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {controlType === "buttons" && options && (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const active = String(currentVal) === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onStateChange(stateKey, opt.value);
                  if (opt.action) onTriggerAction(opt.action);
                }}
                className={`sk-btn h-8 rounded-xl border px-3 text-[12px] ${
                  active
                    ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                    : "border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-text)] hover:border-[var(--sk-accent-line)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {controlType === "slider" && (
        <div className="space-y-1">
          <div className="flex justify-between font-mono text-[12px] text-[var(--sk-accent-ink)]">
            <span>{title || stateKey}</span>
            <span>
              {String(currentVal)}
              {unit}
            </span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(currentVal) || min}
            onChange={(e) => onStateChange(stateKey, Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[var(--sk-accent)]"
          />
        </div>
      )}

      {controlType === "select" && options && (
        <select
          value={String(currentVal)}
          onChange={(e) => {
            const nextVal = e.target.value;
            onStateChange(stateKey, nextVal);
            const found = options.find((o) => o.value === nextVal);
            if (found?.action) onTriggerAction(found.action);
          }}
          className="w-full rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)] px-3 py-1.5 text-[12.5px] text-[var(--sk-text)] outline-none"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {actions && actions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {actions.map((act, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onTriggerAction(act)}
              className="sk-btn h-7.5 rounded-xl border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-3 text-[12px] text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-white"
            >
              <Sparkles size={11.5} />
              {act.label || "Apply"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
