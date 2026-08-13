import type { ThreadId } from "@vide/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

export interface StoredTurnChangeSet {
  readonly threadId: ThreadId;
  readonly fromTurnCount: number;
  readonly toTurnCount: number;
  readonly diff: string;
  readonly createdAt: string;
}

export interface TurnChangeSetStore {
  readonly putTurn: (input: StoredTurnChangeSet) => Effect.Effect<void, SqlError>;
  readonly get: (input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  }) => Effect.Effect<Option.Option<StoredTurnChangeSet>, SqlError>;
}

function joinPatches(left: string, right: string): string {
  const patches = [left.trim(), right.trim()].filter((patch) => patch.length > 0);
  return patches.join("\n");
}

export function makeTurnChangeSetStore(sql: SqlClient.SqlClient): TurnChangeSetStore {
  const get: TurnChangeSetStore["get"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly threadId: ThreadId;
        readonly fromTurnCount: number;
        readonly toTurnCount: number;
        readonly diff: string;
        readonly createdAt: string;
      }>`
        SELECT
          thread_id AS "threadId",
          from_turn_count AS "fromTurnCount",
          to_turn_count AS "toTurnCount",
          diff,
          created_at AS "createdAt"
        FROM checkpoint_diff_blobs
        WHERE thread_id = ${input.threadId}
          AND from_turn_count = ${input.fromTurnCount}
          AND to_turn_count = ${input.toTurnCount}
        LIMIT 1
      `;
      const row = rows[0];
      return row ? Option.some(row) : Option.none();
    });

  const put = (input: StoredTurnChangeSet) =>
    sql`
      INSERT INTO checkpoint_diff_blobs (
        thread_id,
        from_turn_count,
        to_turn_count,
        diff,
        created_at
      )
      VALUES (
        ${input.threadId},
        ${input.fromTurnCount},
        ${input.toTurnCount},
        ${input.diff},
        ${input.createdAt}
      )
      ON CONFLICT (thread_id, from_turn_count, to_turn_count)
      DO UPDATE SET
        diff = excluded.diff,
        created_at = excluded.created_at
    `.pipe(Effect.asVoid);

  const putTurn: TurnChangeSetStore["putTurn"] = (input) =>
    Effect.gen(function* () {
      yield* put(input);
      if (input.fromTurnCount === 0) return;

      const previous = yield* get({
        threadId: input.threadId,
        fromTurnCount: 0,
        toTurnCount: input.fromTurnCount,
      });
      const cumulativeDiff = Option.match(previous, {
        onNone: () => input.diff,
        onSome: (stored) => joinPatches(stored.diff, input.diff),
      });
      yield* put({
        ...input,
        fromTurnCount: 0,
        diff: cumulativeDiff,
      });
    });

  return { putTurn, get };
}
