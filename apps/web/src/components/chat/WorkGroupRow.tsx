import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  MessageCircleIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { memo, use, useState } from "react";

import { cn } from "~/lib/utils";
import { formatWorkspaceRelativePath, splitWorkspaceRelativePath } from "../../filePathDisplay";
import {
  workEntryIndicatesToolFailure,
  workLogEntryIsToolLike,
  type WorkLogEntry,
} from "../../session-logic";
import { ChatGrow } from "./ChatGrow";
import { ChatSwapText } from "./ChatSwapText";
import {
  normalizeCompactToolLabel,
  workEntryHeading,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { QualifiedLabel } from "./QualifiedLabel";
import { TimelineRowCtx } from "./timelineRowContext";
import { summarizeWorkGroup } from "./workGroupSummary";

/**
 * Every tool call between one thought and the next, as one row.
 *
 * While the turn is running the row is the call it is on: the label swaps as the
 * agent moves from one to the next, with the sheen running through it, so the
 * bottom of the transcript is always showing what is happening right now. When
 * the calls are done the same row states what they came to — "Read 3 files" —
 * and the detail is one click away rather than permanently on screen.
 *
 * Which is the whole point of the row existing: six tool calls used to be six
 * lines and a "+4 previous tool calls" toggle, and the answer they were serving
 * was somewhere below all of it.
 */

type TimelineWorkRow = Extract<MessagesTimelineRow, { kind: "work" }>;

export const WorkGroupRow = memo(function WorkGroupRow({ row }: { row: TimelineWorkRow }) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const [open, setOpen] = useState(false);
  const entries = row.groupedEntries;
  const newest = entries.at(-1);
  const failed = entries.some((entry) => workEntryIndicatesToolFailure(entry));

  if (!newest) return null;

  const label = row.live ? workEntryHeading(newest) : summarizeWorkGroup(entries);
  const iconName = row.live ? workEntryIconName(newest) : workGroupIconName(entries);

  return (
    <div data-work-group-state={row.live ? "live" : "done"}>
      <button
        aria-expanded={open}
        className={cn(
          "chat-turn-row rounded-(--radius) py-0.5 pr-2 text-(length:--text-caption)",
          // A live group has nothing to open: its calls are what the label is
          // already reading out, one at a time.
          row.live
            ? "cursor-default"
            : "cursor-pointer transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        data-scroll-anchor-ignore
        disabled={row.live}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex items-center justify-start">
          <WorkEntryIcon
            className={cn(
              "size-3.5 shrink-0 stroke-[1.6]",
              failed
                ? "text-destructive"
                : row.live
                  ? "text-(--ink-secondary)"
                  : "text-(--ink-tertiary)",
            )}
            name={failed ? "circle-alert" : iconName}
          />
        </span>
        <span className="flex min-w-0 items-center text-left text-(--ink-tertiary)">
          <ChatSwapText className="w-full" shimmer={row.live} text={label} />
        </span>
        <span className="flex items-center gap-1 text-(--ink-tertiary)">
          {row.live ? null : (
            <ChevronRightIcon
              aria-hidden="true"
              className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            />
          )}
        </span>
      </button>
      {row.live ? null : (
        <ChatGrow open={open}>
          <div className="chat-turn-body pt-0.5 pb-1">
            {entries.map((entry) => (
              <WorkCallRow entry={entry} key={entry.id} workspaceRoot={workspaceRoot} />
            ))}
          </div>
        </ChatGrow>
      )}
    </div>
  );
});

/**
 * One call: what was run, and what came back.
 *
 * The second line is all the output there is for a command — the server keeps a
 * one-line preview of stdout and drops the rest — so a call that has more to show
 * (an MCP result, the raw command behind a prettified one, the files a patch
 * touched) opens to it rather than pretending the preview was everything.
 */
function WorkCallRow({
  entry,
  workspaceRoot,
}: {
  readonly entry: WorkLogEntry;
  readonly workspaceRoot: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const heading = workEntryHeading(entry);
  const command = entry.rawCommand?.trim() || entry.command?.trim() || null;
  const preview = workEntryPreview(entry, workspaceRoot);
  const body = workEntryExpandedBody(entry, workspaceRoot);
  const failed = workEntryIndicatesToolFailure(entry);
  const showPreview =
    preview !== null &&
    normalizeCompactToolLabel(preview.text).toLowerCase() !==
      normalizeCompactToolLabel(command ?? heading).toLowerCase();

  return (
    <div className="border-t border-(--edge) first:border-t-0">
      <button
        aria-expanded={body === null ? undefined : open}
        className={cn(
          "grid w-full gap-0.5 rounded-(--radius) py-1 text-left",
          body === null
            ? "cursor-default"
            : "cursor-pointer transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        data-scroll-anchor-ignore
        disabled={body === null}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate font-mono text-(length:--text-caption)",
              failed ? "text-destructive" : "text-(--ink-secondary)",
            )}
          >
            {command ?? heading}
          </span>
          {failed ? (
            <XIcon aria-label="Tool call failed" className="size-3 shrink-0 text-destructive" />
          ) : null}
        </span>
        {showPreview ? (
          <span className="min-w-0 truncate text-(length:--text-caption) text-(--ink-tertiary)">
            {preview.path ? (
              <QualifiedLabel
                lead={preview.path.directory}
                name={preview.path.name}
                trail={preview.path.extra}
              />
            ) : (
              preview.text
            )}
          </span>
        ) : null}
      </button>
      {body === null ? null : (
        <ChatGrow open={open}>
          <pre className="max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words pb-1 font-mono text-(length:--text-caption) leading-relaxed text-(--ink-tertiary) select-text">
            {body}
          </pre>
        </ChatGrow>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What a call shows
// ---------------------------------------------------------------------------

/**
 * What a call shows beneath its command.
 *
 * `text` is the flat form, for comparing against the heading. `path` is set only
 * when the preview is a file, so the row can put the file's name in ink and let
 * the folder it lives in recede.
 */
interface WorkEntryPreview {
  readonly text: string;
  readonly path: {
    readonly directory: string;
    readonly name: string;
    readonly extra: string | null;
  } | null;
}

function workEntryPreview(
  entry: Pick<WorkLogEntry, "detail" | "changedFiles">,
  workspaceRoot: string | undefined,
): WorkEntryPreview | null {
  if (entry.detail) return { text: entry.detail, path: null };
  const changedFiles = entry.changedFiles ?? [];
  const [firstPath] = changedFiles;
  if (!firstPath) return null;
  const { directory, fileName } = splitWorkspaceRelativePath(firstPath, workspaceRoot);
  const extra = changedFiles.length > 1 ? `+${String(changedFiles.length - 1)} more` : null;
  const displayPath = `${directory}${fileName}`;
  return {
    text: extra ? `${displayPath} ${extra}` : displayPath,
    path: { directory, name: fileName, extra },
  };
}

/** Everything a call knows that its two lines could not hold. */
function workEntryExpandedBody(
  entry: WorkLogEntry,
  workspaceRoot: string | undefined,
): string | null {
  const blocks: string[] = [];
  if (entry.itemType === "mcp_tool_call" && entry.toolData !== undefined) {
    blocks.push(`MCP call\n${JSON.stringify(entry.toolData, null, 2)}`);
  }
  const rawCommand = entry.rawCommand?.trim();
  const command = entry.command?.trim();
  if (rawCommand && command && rawCommand !== command) {
    blocks.push(command);
  }
  const changedFiles = entry.changedFiles ?? [];
  if (changedFiles.length > 1) {
    blocks.push(
      changedFiles.map((path) => formatWorkspaceRelativePath(path, workspaceRoot)).join("\n"),
    );
  }
  const detail = entry.detail?.trim();
  /* A one-line preview is already on the row; a multi-line one is not. */
  if (detail && detail.includes("\n")) {
    blocks.push(detail);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

type WorkEntryIconName =
  | "bot"
  | "check"
  | "circle-alert"
  | "eye"
  | "globe"
  | "hammer"
  | "message-circle"
  | "square-pen"
  | "terminal"
  | "wrench"
  | "x"
  | "zap";

function WorkEntryIcon({ name, className }: { name: WorkEntryIconName; className: string }) {
  switch (name) {
    case "bot":
      return <BotIcon aria-hidden className={className} />;
    case "check":
      return <CheckIcon aria-hidden className={className} />;
    case "circle-alert":
      return <CircleAlertIcon aria-hidden className={className} />;
    case "eye":
      return <EyeIcon aria-hidden className={className} />;
    case "globe":
      return <GlobeIcon aria-hidden className={className} />;
    case "hammer":
      return <HammerIcon aria-hidden className={className} />;
    case "message-circle":
      return <MessageCircleIcon aria-hidden className={className} />;
    case "square-pen":
      return <SquarePenIcon aria-hidden className={className} />;
    case "terminal":
      return <TerminalIcon aria-hidden className={className} />;
    case "wrench":
      return <WrenchIcon aria-hidden className={className} />;
    case "x":
      return <XIcon aria-hidden className={className} />;
    case "zap":
      return <ZapIcon aria-hidden className={className} />;
  }
}

function workEntryIconName(entry: WorkLogEntry): WorkEntryIconName {
  if (
    entry.sourceActivityKind === "runtime.warning" ||
    entry.sourceActivityKind === "runtime.error"
  ) {
    return "x";
  }
  if (
    entry.sourceActivityKind === "user-input.requested" ||
    entry.sourceActivityKind === "user-input.resolved"
  ) {
    return "message-circle";
  }
  if (entry.requestKind === "command") return "terminal";
  if (entry.requestKind === "file-read") return "eye";
  if (entry.requestKind === "file-change") return "square-pen";

  if (entry.itemType === "command_execution" || entry.command) return "terminal";
  if (entry.itemType === "file_change" || (entry.changedFiles?.length ?? 0) > 0) {
    return "square-pen";
  }
  if (entry.itemType === "web_search") return "globe";
  if (entry.itemType === "image_view") return "eye";

  switch (entry.itemType) {
    case "mcp_tool_call":
      return "wrench";
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return "hammer";
    default:
      break;
  }

  if (entry.tone === "error") return "circle-alert";
  if (entry.tone === "thinking") return "bot";
  if (entry.tone === "info") return "check";
  return workLogEntryIsToolLike(entry) ? "wrench" : "zap";
}

/** One glyph for a whole group: what they all were, or a tool if they differ. */
function workGroupIconName(entries: ReadonlyArray<WorkLogEntry>): WorkEntryIconName {
  const [first, ...rest] = entries;
  if (!first) return "wrench";
  const name = workEntryIconName(first);
  return rest.every((entry) => workEntryIconName(entry) === name) ? name : "wrench";
}
