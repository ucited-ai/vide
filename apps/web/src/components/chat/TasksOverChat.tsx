import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { type ActivePlanState } from "../../session-logic";

/**
 * The task list, over the chat — the slim reading of the plan.
 *
 * PlanSidebar stays the working surface (markdown, approval, timestamps); this
 * is the glanceable one: one row per step, status carried by the glyph, capped
 * and scrollable so a long plan never crowds the composer. Rows transition in
 * on their first paint (`.chat-task-row` in vide-theme.css), so a plan being
 * written by the agent appears step by step instead of landing as a block.
 */
export function TasksOverChat({ plan }: { readonly plan: ActivePlanState }) {
  const done = plan.steps.filter((step) => step.status === "completed").length;

  return (
    <div className="mx-auto flex max-h-[min(40vh,20rem)] w-full max-w-(--chat-column-width) min-h-0 flex-col overflow-hidden rounded-[var(--envcol-radius)] border border-(--envcol-edge) bg-(--envcol-surface) shadow-[var(--envcol-shadow)]">
      <div className="flex shrink-0 items-baseline justify-between px-3 pt-2 pb-1 text-(length:--text-caption) text-(--ink-tertiary)">
        <span>Tasks</span>
        <span className="tabular-nums">
          {done}/{plan.steps.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {/* Index keys on purpose: steps carry no id, and the agent only ever
            appends or restates — an index key keeps settled rows' DOM (and so
            their already-run entrance) while a new index mounts and animates. */}
        {plan.steps.map((step, index) => (
          <div
            className="chat-task-row flex items-start gap-2 rounded-(--radius) px-1.5 py-1 text-(length:--text-caption)"
            key={index}
          >
            <TaskStatusGlyph status={step.status} />
            <span
              className={cn(
                "min-w-0 flex-1",
                step.status === "completed"
                  ? "text-(--ink-tertiary) line-through decoration-(--edge-strong)"
                  : step.status === "inProgress"
                    ? "text-(--ink)"
                    : "text-(--ink-secondary)",
              )}
            >
              {step.step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Status as a mark, not a word: check, live dot, empty ring. */
function TaskStatusGlyph({
  status,
}: {
  readonly status: ActivePlanState["steps"][number]["status"];
}) {
  if (status === "completed") {
    return (
      <CheckIcon aria-label="Completed" className="mt-0.5 size-3 shrink-0 text-(--ink-tertiary)" />
    );
  }
  if (status === "inProgress") {
    return (
      <span
        aria-label="In progress"
        className="mt-1 flex size-3 shrink-0 items-center justify-center"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-(--ink)" />
      </span>
    );
  }
  return (
    <span aria-label="Pending" className="mt-1 flex size-3 shrink-0 items-center justify-center">
      <span className="size-1.5 rounded-full border border-(--edge-strong)" />
    </span>
  );
}
