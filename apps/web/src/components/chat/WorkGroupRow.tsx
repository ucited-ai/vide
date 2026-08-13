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
import { FileDiff } from "@pierre/diffs/react";
import { memo, use, useState } from "react";

import { cn } from "~/lib/utils";
import { formatWorkspaceRelativePath, splitWorkspaceRelativePath } from "../../filePathDisplay";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import {
  workEntryIndicatesToolFailure,
  workLogEntryIsToolLike,
  type WorkLogFileChange,
  type WorkLogEntry,
} from "../../session-logic";
import { ChatGrow } from "./ChatGrow";
import { ChatSwapText } from "./ChatSwapText";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
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
  const { workspaceRoot, workRowOpenById } = use(TimelineRowCtx);
  /* Seeded from (and written back to) the timeline's map, so the open state
     survives this row leaving the virtualizer's buffer and coming back. */
  const [open, setOpenState] = useState(() => workRowOpenById.get(row.id) ?? false);
  const setOpen = (update: (value: boolean) => boolean) => {
    setOpenState((value) => {
      const next = update(value);
      workRowOpenById.set(row.id, next);
      return next;
    });
  };
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
        className="chat-turn-row cursor-pointer rounded-(--radius) py-0.5 pr-2 text-(length:--text-caption) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        data-scroll-anchor-ignore
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
          <ChevronRightIcon
            aria-hidden="true"
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          />
        </span>
      </button>
      {/* Open while live, the group shows the calls made so far — the list
          grows in place as the agent moves on, so "what is happening" and
          "what happened" are the same view at different moments. */}
      <ChatGrow open={open}>
        <WorkCallList entries={entries} workspaceRoot={workspaceRoot} />
      </ChatGrow>
    </div>
  );
});

export const WorkCallList = memo(function WorkCallList({
  entries,
  workspaceRoot,
}: {
  readonly entries: ReadonlyArray<WorkLogEntry>;
  readonly workspaceRoot: string | undefined;
}) {
  return (
    <div className="chat-turn-body pt-0.5 pb-1">
      {entries.map((entry) => (
        <WorkCallRow entry={entry} key={entry.id} workspaceRoot={workspaceRoot} />
      ))}
    </div>
  );
});

/**
 * One call: what was run, and what came back.
 *
 * Calls retain their provider payload. The compact row stays scannable; opening
 * it reveals command output, inline patches, sources, or structured MCP values.
 */
function WorkCallRow({
  entry,
  workspaceRoot,
}: {
  readonly entry: WorkLogEntry;
  readonly workspaceRoot: string | undefined;
}) {
  const { resolvedTheme, workRowOpenById } = use(TimelineRowCtx);
  const [open, setOpenState] = useState(() => workRowOpenById.get(entry.id) ?? false);
  const setOpen = (update: (value: boolean) => boolean) => {
    setOpenState((value) => {
      const next = update(value);
      workRowOpenById.set(entry.id, next);
      return next;
    });
  };
  const heading = workEntryHeading(entry);
  const command = entry.rawCommand?.trim() || entry.command?.trim() || null;
  const preview = workEntryPreview(entry, workspaceRoot);
  const hasBody = workEntryHasExpandedBody(entry);
  const failed = workEntryIndicatesToolFailure(entry);
  const fileStat = totalFileStat(entry.fileChanges ?? []);
  const compactMeta = workEntryCompactMeta(entry);
  const showPreview =
    preview !== null &&
    normalizeCompactToolLabel(preview.text).toLowerCase() !==
      normalizeCompactToolLabel(command ?? heading).toLowerCase();

  return (
    <div className="border-t border-(--edge) first:border-t-0">
      <button
        aria-expanded={hasBody ? open : undefined}
        className={cn(
          "grid w-full gap-0.5 rounded-(--radius) py-1 text-left",
          !hasBody
            ? "cursor-default"
            : "cursor-pointer transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        data-scroll-anchor-ignore
        disabled={!hasBody}
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
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-(length:--text-caption) text-(--ink-tertiary)">
            {compactMeta ? <span>{compactMeta}</span> : null}
            {hasNonZeroStat(fileStat) ? (
              <DiffStatLabel
                additions={fileStat.additions}
                deletions={fileStat.deletions}
                layout="inline"
              />
            ) : null}
            {hasBody ? (
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
              />
            ) : null}
          </span>
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
      {!hasBody ? null : (
        <ChatGrow open={open}>
          <WorkCallExpandedDetails
            entry={entry}
            resolvedTheme={resolvedTheme}
            workspaceRoot={workspaceRoot}
          />
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
  entry: Pick<WorkLogEntry, "detail" | "changedFiles" | "webSearch">,
  workspaceRoot: string | undefined,
): WorkEntryPreview | null {
  if (entry.webSearch?.query) return { text: entry.webSearch.query, path: null };
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

function totalFileStat(changes: ReadonlyArray<WorkLogFileChange>) {
  return changes.reduce(
    (total, change) => ({
      additions: total.additions + change.additions,
      deletions: total.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${String(Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1).replace(/\.0$/u, "")}s`;
  return `${String(Math.round(durationMs / 1_000))}s`;
}

function workEntryCompactMeta(entry: WorkLogEntry): string | null {
  const changes = entry.fileChanges ?? [];
  const statuses = [
    ...new Set(changes.flatMap((change) => (change.status ? [change.status] : []))),
  ];
  if (changes.length === 1 && statuses[0]) return statuses[0];
  if (changes.length > 1) return `${String(changes.length)} files`;
  if (entry.commandDetails?.exitCode !== undefined) {
    const duration = entry.commandDetails.durationMs;
    return `exit ${String(entry.commandDetails.exitCode)}${duration === undefined ? "" : ` · ${formatDuration(duration)}`}`;
  }
  if (entry.commandDetails?.durationMs !== undefined) {
    return formatDuration(entry.commandDetails.durationMs);
  }
  if (entry.webSearch && entry.webSearch.sources.length > 0) {
    return `${String(entry.webSearch.sources.length)} sources`;
  }
  return null;
}

function workEntryHasExpandedBody(entry: WorkLogEntry): boolean {
  if ((entry.fileChanges?.length ?? 0) > 0) return true;
  if (entry.commandDetails) return true;
  if (entry.webSearch) return true;
  if (entry.mcpDetails) return true;
  if (entry.toolInput !== undefined || entry.toolResult !== undefined) return true;
  const rawCommand = entry.rawCommand?.trim();
  const command = entry.command?.trim();
  return Boolean(
    (rawCommand && command && rawCommand !== command) || entry.detail?.trim().includes("\n"),
  );
}

export function WorkCallExpandedDetails({
  entry,
  resolvedTheme,
  workspaceRoot,
}: {
  readonly entry: WorkLogEntry;
  readonly resolvedTheme: "light" | "dark";
  readonly workspaceRoot: string | undefined;
}) {
  const command = entry.commandDetails;
  const webSearch = entry.webSearch;
  const mcp = entry.mcpDetails;
  const rawCommand = entry.rawCommand?.trim();
  const displayCommand = entry.command?.trim();

  return (
    <div className="space-y-2 pb-1 text-(length:--text-caption) text-(--ink-tertiary)">
      {command ? (
        <section className="space-y-1">
          <DetailMeta
            items={[
              command.cwd ? `cwd ${formatWorkspaceRelativePath(command.cwd, workspaceRoot)}` : null,
              command.exitCode === undefined ? null : `exit ${String(command.exitCode)}`,
              command.durationMs === undefined ? null : formatDuration(command.durationMs),
            ]}
          />
          {command.output ? <OutputBlock text={command.output} /> : null}
        </section>
      ) : null}
      {rawCommand && displayCommand && rawCommand !== displayCommand ? (
        <OutputBlock text={displayCommand} />
      ) : null}
      {(entry.fileChanges ?? []).map((change, index) => (
        <FileChangeDetails
          change={change}
          key={`${change.path}:${String(index)}`}
          resolvedTheme={resolvedTheme}
          workspaceRoot={workspaceRoot}
        />
      ))}
      {webSearch ? (
        <section className="space-y-1.5">
          {webSearch.query ? (
            <div className="cursor-text select-text text-(--ink-secondary)">{webSearch.query}</div>
          ) : null}
          {webSearch.sources.length > 0 ? (
            <ol className="space-y-1">
              {webSearch.sources.map((source) => (
                <li className="min-w-0" key={source.url}>
                  <a
                    className="block truncate underline decoration-(--edge) underline-offset-2 hover:text-(--ink-secondary)"
                    href={source.url}
                    rel="noreferrer"
                    target="_blank"
                    title={source.url}
                  >
                    {source.title ?? source.url}
                  </a>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
      {mcp ? (
        <section className="space-y-1.5">
          <DetailMeta
            items={[
              mcp.server ? `server ${mcp.server}` : null,
              mcp.tool ? `tool ${mcp.tool}` : null,
              mcp.durationMs === undefined ? null : formatDuration(mcp.durationMs),
            ]}
          />
          {mcp.error ? <p className="text-destructive">{mcp.error}</p> : null}
          {mcp.arguments !== undefined ? (
            <StructuredSection label="Arguments" value={mcp.arguments} />
          ) : null}
          {mcp.result !== undefined ? (
            <StructuredSection label="Result" value={mcp.result} />
          ) : null}
        </section>
      ) : null}
      {!command && !webSearch && !mcp && (entry.fileChanges?.length ?? 0) === 0 ? (
        <>
          {entry.toolInput !== undefined ? (
            <StructuredSection label="Input" value={entry.toolInput} />
          ) : null}
          {entry.toolResult !== undefined ? (
            <StructuredSection label="Result" value={entry.toolResult} />
          ) : null}
          {entry.detail?.includes("\n") ? <OutputBlock text={entry.detail} /> : null}
        </>
      ) : null}
    </div>
  );
}

function DetailMeta({ items }: { readonly items: ReadonlyArray<string | null> }) {
  const visible = items.filter((item): item is string => item !== null);
  return visible.length === 0 ? null : (
    <div className="flex flex-wrap gap-x-2 font-mono text-(length:--text-caption)">
      {visible.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function OutputBlock({ text }: { readonly text: string }) {
  return (
    <pre className="max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words rounded-(--radius) bg-(--wash) p-2 font-mono leading-relaxed text-(--ink-secondary) select-text">
      {text}
    </pre>
  );
}

function FileChangeDetails({
  change,
  resolvedTheme,
  workspaceRoot,
}: {
  readonly change: WorkLogFileChange;
  readonly resolvedTheme: "light" | "dark";
  readonly workspaceRoot: string | undefined;
}) {
  const renderable = getRenderablePatch(change.diff, `tool-call:${change.path}`);
  return (
    <section className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-mono text-(--ink-secondary)">
          {formatWorkspaceRelativePath(change.path, workspaceRoot)}
        </span>
        {change.status ? <span className="shrink-0">{change.status}</span> : null}
        {hasNonZeroStat(change) ? (
          <DiffStatLabel
            additions={change.additions}
            className="ml-auto shrink-0"
            deletions={change.deletions}
            layout="inline"
          />
        ) : null}
      </div>
      {change.previousPath ? (
        <div>from {formatWorkspaceRelativePath(change.previousPath, workspaceRoot)}</div>
      ) : null}
      {renderable?.kind === "files"
        ? renderable.files.map((fileDiff) => (
            <FileDiff
              fileDiff={fileDiff}
              key={resolveFileDiffPath(fileDiff)}
              options={{
                collapsed: false,
                diffStyle: "unified",
                overflow: "scroll",
                theme: resolveDiffThemeName(resolvedTheme),
              }}
            />
          ))
        : null}
      {renderable?.kind === "raw" ? <OutputBlock text={renderable.text} /> : null}
    </section>
  );
}

function StructuredSection({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <section className="space-y-1">
      <div className="text-(--ink-secondary)">{label}</div>
      <div className="max-h-64 overflow-auto rounded-(--radius) bg-(--wash) p-2 font-mono">
        <StructuredValue value={value} />
      </div>
    </section>
  );
}

function StructuredValue({
  value,
  depth = 0,
}: {
  readonly value: unknown;
  readonly depth?: number;
}) {
  if (value === null) return <span>null</span>;
  if (typeof value === "string") {
    return <span className="whitespace-pre-wrap break-words text-(--ink-secondary)">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    const rows = value.map((item, position) => ({
      item,
      position,
      key: `${String(depth)}:${String(position)}`,
    }));
    return (
      <div className="space-y-1">
        {rows.map((row) => (
          <div className="grid grid-cols-[2ch_minmax(0,1fr)] gap-1" key={row.key}>
            <span>{row.position}</span>
            <StructuredValue depth={depth + 1} value={row.item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return (
      <div className="space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div
            className={cn("grid gap-1", depth < 3 && "grid-cols-[minmax(5rem,auto)_minmax(0,1fr)]")}
            key={key}
          >
            <span className="text-(--ink-tertiary)">{key}</span>
            <StructuredValue depth={depth + 1} value={item} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
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
  if (entry.itemType === "file_read") return "eye";
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
