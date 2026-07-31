import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunProcessOptions {
  readonly cwd?: string;
  /** Bytes of stdout to keep. Pickaxe diffs of bulk commits are unbounded. */
  readonly maxStdoutBytes?: number;
}

class ProcessRunError extends Data.TaggedError("ProcessRunError")<{
  readonly executable: string;
  readonly argumentCount: number;
  readonly operation: "spawn" | "communicate";
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Failed to run ${this.executable} (${this.argumentCount} arguments) during ${this.operation}.`;
  }
}

const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  maxBytes: number,
): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (accumulated, chunk) => (accumulated.length >= maxBytes ? accumulated : accumulated + chunk),
    ),
  );

/**
 * Spawn a process and collect its output. Never fails on a non-zero exit code —
 * the caller decides what an exit code means, which is the whole point for
 * `staged-format.ts`, where one specific failure is a success.
 */
export const runProcess = Effect.fnUntraced(function* (
  executable: string,
  args: ReadonlyArray<string>,
  options: RunProcessOptions = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const context = { executable, argumentCount: args.length } as const;
  const maxBytes = options.maxStdoutBytes ?? Number.MAX_SAFE_INTEGER;

  const child = yield* spawner
    .spawn(ChildProcess.make(executable, args, options.cwd ? { cwd: options.cwd } : {}))
    .pipe(
      Effect.mapError((cause) => new ProcessRunError({ ...context, operation: "spawn", cause })),
    );

  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout, maxBytes),
      collectStreamAsString(child.stderr, maxBytes),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError(
      (cause) => new ProcessRunError({ ...context, operation: "communicate", cause }),
    ),
  );

  return { exitCode, stdout, stderr } satisfies ProcessResult;
}, Effect.scoped);
