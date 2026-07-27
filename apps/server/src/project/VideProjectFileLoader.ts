/**
 * VideProjectFileLoader - Effect service that loads the checked-in `vide.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module VideProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { Vide_PROJECT_FILE_NAME, type VideProjectFile } from "@vide/contracts";
import { VideProjectFileFromJson } from "@vide/shared/videProjectFile";

const decodeVideProjectFileJson = Schema.decodeEffect(VideProjectFileFromJson);

export class VideProjectFileLoadError extends Schema.TaggedErrorClass<VideProjectFileLoadError>()(
  "VideProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${Vide_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for vide.json project file loading. */
export class VideProjectFileLoader extends Context.Service<
  VideProjectFileLoader,
  {
    /**
     * Load and decode `vide.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<VideProjectFile>>;
  }
>()("vide/project/VideProjectFileLoader") {}

const logVideProjectFileLoadError = (error: VideProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: VideProjectFileLoader["Service"]["load"] = Effect.fn("VideProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, Vide_PROJECT_FILE_NAME);
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logVideProjectFileLoadError(
                  new VideProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<VideProjectFile>();
      }
      return yield* decodeVideProjectFileJson(raw.value).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          SchemaError: (error) =>
            logVideProjectFileLoadError(
              new VideProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<VideProjectFile>())),
        }),
      );
    },
  );

  return VideProjectFileLoader.of({ load });
});

export const layer = Layer.effect(VideProjectFileLoader, make);
