import { ThreadId } from "@vide/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect } from "vite-plus/test";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeTurnChangeSetStore } from "./TurnChangeSetStore.ts";

describe("TurnChangeSetStore", () => {
  it.effect("stores exact turn artifacts and a semantic session history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = makeTurnChangeSetStore(sql);
      const threadId = ThreadId.make("thread-store");

      yield* store.putTurn({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 1,
        diff: "first patch",
        createdAt: "2026-08-05T12:00:00.000Z",
      });
      yield* store.putTurn({
        threadId,
        fromTurnCount: 1,
        toTurnCount: 2,
        diff: "second patch",
        createdAt: "2026-08-05T12:01:00.000Z",
      });

      const exact = yield* store.get({ threadId, fromTurnCount: 1, toTurnCount: 2 });
      const session = yield* store.get({ threadId, fromTurnCount: 0, toTurnCount: 2 });
      expect(Option.getOrThrow(exact).diff).toBe("second patch");
      expect(Option.getOrThrow(session).diff).toBe("first patch\nsecond patch");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
