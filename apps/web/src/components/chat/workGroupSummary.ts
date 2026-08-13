import { workLogEntryIsToolLike, type WorkLogEntry } from "../../session-logic";

/**
 * What a group of tool calls is called once it is over.
 *
 * The live row names the call it is on; a finished one has to name all of them at
 * once, and "6 tool calls" says nothing a reader wanted to know. So the calls are
 * bucketed by what they did to the workspace and the buckets are read out in
 * order — "Read 3 files · ran 2 commands" — which is the same sentence someone
 * would write in a commit message about the same work.
 *
 * Counting is deliberately conservative: one entry is one thing done, except for
 * edits, where the provider tells us which files a patch touched and claiming
 * "Edited 3 files" for three hunks of one file would be a lie.
 */

const BUCKET_ORDER = ["read", "edit", "command", "search", "tool", "note"] as const;

type WorkGroupBucket = (typeof BUCKET_ORDER)[number];

function workEntryBucket(entry: WorkLogEntry): WorkGroupBucket {
  if (!workLogEntryIsToolLike(entry)) {
    return "note";
  }
  if (entry.requestKind === "file-read") return "read";
  if (entry.requestKind === "file-change") return "edit";
  if (entry.requestKind === "command") return "command";

  switch (entry.itemType) {
    case "command_execution":
      return "command";
    case "file_read":
      return "read";
    case "file_change":
      return "edit";
    case "web_search":
      return "search";
    case "image_view":
      return "read";
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return "tool";
    default:
      break;
  }

  if (entry.command !== undefined && entry.command.trim().length > 0) return "command";
  if ((entry.changedFiles?.length ?? 0) > 0) return "edit";
  return "tool";
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `${String(count)} ${one}` : `${String(count)} ${many}`;
}

function bucketPhrase(bucket: WorkGroupBucket, count: number): string {
  switch (bucket) {
    case "read":
      return `Read ${plural(count, "file", "files")}`;
    case "edit":
      return `Edited ${plural(count, "file", "files")}`;
    case "command":
      return `Ran ${plural(count, "command", "commands")}`;
    case "search":
      return count === 1 ? "Searched the web" : `Searched the web ${String(count)} times`;
    case "tool":
      return `Called ${plural(count, "tool", "tools")}`;
    case "note":
      return plural(count, "log entry", "log entries");
  }
}

/** Lowercased where it follows another phrase, so the row reads as one sentence. */
function continuePhrase(phrase: string): string {
  return `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
}

export function summarizeWorkGroup(entries: ReadonlyArray<WorkLogEntry>): string {
  const counts = new Map<WorkGroupBucket, number>();
  const editedFiles = new Set<string>();
  let editEntries = 0;

  for (const entry of entries) {
    const bucket = workEntryBucket(entry);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    if (bucket === "edit") {
      editEntries += 1;
      for (const path of entry.changedFiles ?? []) {
        editedFiles.add(path);
      }
    }
  }

  if (counts.size === 0) {
    return "Worked";
  }
  if (editEntries > 0) {
    counts.set("edit", Math.max(editEntries, editedFiles.size));
  }

  const phrases = BUCKET_ORDER.flatMap((bucket) => {
    const count = counts.get(bucket);
    return count === undefined ? [] : [bucketPhrase(bucket, count)];
  });

  return phrases
    .map((phrase, index) => (index === 0 ? phrase : continuePhrase(phrase)))
    .join(" · ");
}
