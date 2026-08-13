import type {
  OrchestrationCheckpointFile,
  ProviderFileMutation,
  ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from "@vide/contracts";

import { parseTurnDiffFilesFromUnifiedDiff } from "../checkpointing/Diffs.ts";

export interface TurnChangeSet {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly unifiedDiff: string;
  readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
  readonly source: "provider-turn-diff" | "structured-file-mutations" | "none";
}

interface PendingTurnChangeSet {
  authoritativeDiff: string | undefined;
  authoritativeFiles: ReadonlyArray<ProviderFileMutation> | undefined;
  readonly mutationsByItemAndPath: Map<string, ProviderFileMutation>;
}

function turnKey(threadId: ThreadId, turnId: TurnId): string {
  return `${threadId}:${turnId}`;
}

function checkpointFilesFromMutations(
  mutations: ReadonlyArray<ProviderFileMutation>,
): ReadonlyArray<OrchestrationCheckpointFile> {
  const byPath = new Map<string, OrchestrationCheckpointFile>();
  for (const mutation of mutations) {
    const previous = byPath.get(mutation.path);
    byPath.set(mutation.path, {
      path: mutation.path,
      kind: mutation.kind ?? previous?.kind ?? "modified",
      additions: (previous?.additions ?? 0) + (mutation.additions ?? 0),
      deletions: (previous?.deletions ?? 0) + (mutation.deletions ?? 0),
    });
  }
  return [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

function checkpointFilesFromDiff(diff: string): ReadonlyArray<OrchestrationCheckpointFile> {
  try {
    return parseTurnDiffFilesFromUnifiedDiff(diff).map((file) => ({
      path: file.path,
      kind: "modified",
      additions: file.additions,
      deletions: file.deletions,
    }));
  } catch {
    return [];
  }
}

function joinMutationPatches(mutations: ReadonlyArray<ProviderFileMutation>): string {
  return mutations
    .flatMap((mutation) => {
      const patch = mutation.patch?.trim();
      return patch ? [patch] : [];
    })
    .join("\n");
}

/**
 * Owns the provider-independent meaning of "files changed by this turn".
 *
 * Provider adapters report either an authoritative turn snapshot or structured
 * file mutations. The assembler deliberately never samples the ambient
 * worktree: another session changing the same checkout is not evidence that
 * this turn changed anything.
 */
export class TurnChangeSetAssembler {
  readonly #pendingByTurn = new Map<string, PendingTurnChangeSet>();

  observe(event: ProviderRuntimeEvent): void {
    const turnId = event.turnId;
    if (!turnId) return;

    const key = turnKey(event.threadId, turnId);
    if (event.type === "turn.started") {
      this.#pendingByTurn.set(key, {
        authoritativeDiff: undefined,
        authoritativeFiles: undefined,
        mutationsByItemAndPath: new Map(),
      });
      return;
    }

    if (event.type === "turn.aborted") {
      this.#pendingByTurn.delete(key);
      return;
    }

    const pending = this.#pendingByTurn.get(key) ?? {
      authoritativeDiff: undefined,
      authoritativeFiles: undefined,
      mutationsByItemAndPath: new Map(),
    };

    if (event.type === "turn.diff.updated") {
      pending.authoritativeDiff = event.payload.unifiedDiff;
      pending.authoritativeFiles = event.payload.fileChanges;
      this.#pendingByTurn.set(key, pending);
      return;
    }

    if (
      (event.type === "item.updated" || event.type === "item.completed") &&
      event.payload.fileChanges
    ) {
      for (const mutation of event.payload.fileChanges) {
        pending.mutationsByItemAndPath.set(
          `${event.itemId ?? event.eventId}:${mutation.path}`,
          mutation,
        );
      }
      this.#pendingByTurn.set(key, pending);
    }
  }

  complete(event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>): TurnChangeSet | null {
    const turnId = event.turnId;
    if (!turnId) return null;

    const key = turnKey(event.threadId, turnId);
    const pending = this.#pendingByTurn.get(key);
    this.#pendingByTurn.delete(key);

    if (pending?.authoritativeDiff !== undefined) {
      const files =
        pending.authoritativeFiles && pending.authoritativeFiles.length > 0
          ? checkpointFilesFromMutations(pending.authoritativeFiles)
          : checkpointFilesFromDiff(pending.authoritativeDiff);
      return {
        threadId: event.threadId,
        turnId,
        unifiedDiff: pending.authoritativeDiff,
        files,
        source: "provider-turn-diff",
      };
    }

    const mutations = [...(pending?.mutationsByItemAndPath.values() ?? [])];
    if (mutations.length > 0) {
      return {
        threadId: event.threadId,
        turnId,
        unifiedDiff: joinMutationPatches(mutations),
        files: checkpointFilesFromMutations(mutations),
        source: "structured-file-mutations",
      };
    }

    return {
      threadId: event.threadId,
      turnId,
      unifiedDiff: "",
      files: [],
      source: "none",
    };
  }

  clearThread(threadId: ThreadId): void {
    const prefix = `${threadId}:`;
    for (const key of this.#pendingByTurn.keys()) {
      if (key.startsWith(prefix)) this.#pendingByTurn.delete(key);
    }
  }
}
