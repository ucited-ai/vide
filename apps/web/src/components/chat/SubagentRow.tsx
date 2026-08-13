import { BotIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { memo, use, useState } from "react";

import { cn } from "~/lib/utils";
import type { SubagentSummary } from "../../subagentActivity";
import ChatMarkdown from "../ChatMarkdown";
import { ChatGrow } from "./ChatGrow";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { TimelineRowCtx } from "./timelineRowContext";

type StartedRow = Extract<MessagesTimelineRow, { kind: "subagents-started" }>;
type FinishedRow = Extract<MessagesTimelineRow, { kind: "subagent-finished" }>;

export const SubagentsStartedRow = memo(function SubagentsStartedRow({ row }: { row: StartedRow }) {
  const { onOpenSubagent } = use(TimelineRowCtx);
  return (
    <div className="chat-turn-body flex flex-wrap items-center gap-1.5 py-0.5 text-(length:--text-caption) text-(--ink-tertiary)">
      {row.agents.map((agent) => (
        <button
          className="inline-flex max-w-48 cursor-pointer items-center gap-1.5 rounded-full border border-(--edge) bg-(--agent-chip-bg) px-2 py-0.5 transition-colors hover:bg-(--agent-chip-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          data-agent-color={agent.colorIndex}
          key={agent.agent.agentId}
          onClick={() => onOpenSubagent(agent.agent.agentId)}
          type="button"
        >
          <AgentMark agent={agent} />
          <span className="truncate text-(--ink-secondary)">{agent.name}</span>
          <span className="sr-only">{agent.status}</span>
        </button>
      ))}
      <span>{row.agents.length === 1 ? "started working" : "started working"}</span>
    </div>
  );
});

export const SubagentFinishedRow = memo(function SubagentFinishedRow({
  row,
}: {
  row: FinishedRow;
}) {
  const ctx = use(TimelineRowCtx);
  const stateKey = `subagent-ping:${row.agent.agent.agentId}`;
  const [open, setOpenState] = useState(() => ctx.workRowOpenById.get(stateKey) ?? false);
  const setOpen = (next: boolean) => {
    ctx.workRowOpenById.set(stateKey, next);
    setOpenState(next);
  };
  const duration = row.agent.durationMs === null ? null : compactDuration(row.agent.durationMs);
  const expandable = row.agent.finalText !== null;

  return (
    <div>
      <button
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "chat-turn-row py-0.5 pr-2 text-(length:--text-caption) text-(--ink-tertiary)",
          expandable &&
            "cursor-pointer rounded-(--radius) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="flex items-center justify-start">
          <AgentMark agent={row.agent} />
        </span>
        <span className="min-w-0 truncate text-left text-(--ink-secondary)">
          {row.agent.name} — {row.agent.status === "failed" ? "failed" : "finished"}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          {duration}
          {expandable ? (
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 transition-transform", open && "rotate-90")}
            />
          ) : null}
        </span>
      </button>
      <ChatGrow open={expandable && open}>
        <div className="chat-turn-body max-h-64 overflow-auto pb-1 pr-2 text-(length:--text-chat)">
          {row.agent.finalText ? (
            <ChatMarkdown
              className="text-foreground"
              cwd={ctx.markdownCwd}
              skills={ctx.skills}
              text={row.agent.finalText}
              threadRef={ctx.threadRef ?? undefined}
            />
          ) : null}
        </div>
      </ChatGrow>
    </div>
  );
});

function AgentMark({ agent }: { readonly agent: SubagentSummary }) {
  const Icon =
    agent.status === "failed" ? CircleAlertIcon : agent.status === "finished" ? CheckIcon : BotIcon;
  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-(--agent-mark-bg) text-(--agent-mark-ink)"
      data-agent-color={agent.colorIndex}
    >
      <Icon aria-hidden className="size-2.5 stroke-[1.8]" />
    </span>
  );
}

function compactDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${String(Math.round(durationMs))}ms`;
  if (durationMs < 60_000) return `${String(Math.round(durationMs / 1_000))}s`;
  return `${String(Math.round(durationMs / 60_000))}m`;
}
