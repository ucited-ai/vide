import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@vide/shared/hostProcess";
import { SpawnExecutableResolution } from "@vide/shared/shell";
import * as ExternalLauncher from "./externalLauncher.ts";

function makeMockDetachedHandle(onUnref: () => void = () => undefined, stdout = "") {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      onUnref();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout: stdout.length === 0 ? Stream.empty : Stream.make(new TextEncoder().encode(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

/** One `mdfind -attr kMDItemCFBundleIdentifier` result line. */
const mdfindBundleLine = (appPath: string, bundleId: string) =>
  `${appPath}    kMDItemCFBundleIdentifier = ${bundleId}\n`;

const testLayer = (input: {
  readonly platform: NodeJS.Platform;
  readonly env?: Record<string, string>;
  readonly resolveExecutable?: (command: string) => string | undefined;
  readonly stdoutFor?: (command: ChildProcess.StandardCommand) => string | undefined;
  readonly onSpawn?: (command: ChildProcess.StandardCommand) => void;
  readonly onUnref?: () => void;
}) => {
  const spawnerLayer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected a standard command");
        }
        input.onSpawn?.(command);
        return makeMockDetachedHandle(input.onUnref, input.stdoutFor?.(command) ?? "");
      }),
    ),
  );

  return Layer.mergeAll(
    ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawnerLayer))),
    Layer.succeed(HostProcessPlatform, input.platform),
    Layer.succeed(
      SpawnExecutableResolution,
      (command) => input.resolveExecutable?.(command) ?? command,
    ),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} })),
  );
};

it.effect("launches the default browser through the platform command", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    yield* launcher.launchBrowser("https://example.com/some path");

    assert.ok(spawned);
    assert.equal(spawned.command, "xdg-open");
    assert.deepEqual(spawned.args, ["https://example.com/some path"]);
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "linux",
        onSpawn: (command) => {
          spawned = command;
        },
        onUnref: () => {
          didUnref = true;
        },
      }),
    ),
  );
});

it.effect("launches an installed editor with platform-safe arguments", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vide-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");

    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "vscode",
        cwd: "C:\\workspace with spaces\\src\\index.ts:12:4",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
          resolveExecutable: (command) =>
            command === "code" ? "C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD" : command,
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, '^"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.CMD^"');
    assert.deepEqual(spawned.args, [
      '^"--goto^"',
      '^"C:\\workspace^ with^ spaces\\src\\index.ts:12:4^"',
    ]);
    assert.equal(spawned.options.shell, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers editors through the service API", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vide-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");
    yield* fileSystem.writeFileString(path.join(binDir, "explorer.CMD"), "@echo off\r\n");

    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      return yield* launcher.resolveAvailableEditors();
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        }),
      ),
    );

    assert.equal(editors.includes("vscode"), true);
    assert.equal(editors.includes("file-manager"), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

/**
 * Stands in for the Spotlight probe: answers `mdfind` with a result line for
 * every requested bundle identifier that `installedBundleIds` contains.
 */
const mdfindStdoutFor =
  (installedBundleIds: ReadonlyArray<string>) => (command: ChildProcess.StandardCommand) => {
    if (command.command !== "mdfind") return undefined;
    const query = command.args.at(-1) ?? "";
    return installedBundleIds
      .filter((bundleId) => query.includes(`'${bundleId}'`))
      .map((bundleId) => mdfindBundleLine(`/Applications/${bundleId}.app`, bundleId))
      .join("");
  };

/** Creates a POSIX-executable stub so `open` resolves without a real macOS host. */
const makeExecutableStubDir = Effect.fn("test.makeExecutableStubDir")(function* (
  ...commands: ReadonlyArray<string>
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vide-editors-" });
  for (const command of commands) {
    const commandPath = path.join(binDir, command);
    yield* fileSystem.writeFileString(commandPath, "#!/bin/sh\n");
    yield* fileSystem.chmod(commandPath, 0o755);
  }
  return binDir;
});

it.effect("discovers macOS editors that ship an app bundle but no CLI", () =>
  Effect.gen(function* () {
    const binDir = yield* makeExecutableStubDir("open");

    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      return yield* launcher.resolveAvailableEditors();
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "darwin",
          env: { PATH: binDir },
          stdoutFor: mdfindStdoutFor(["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92"]),
        }),
      ),
    );

    assert.deepEqual([...editors], ["cursor", "vscode", "file-manager"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("launches an installed app bundle when the editor exposes no CLI", () =>
  Effect.gen(function* () {
    const binDir = yield* makeExecutableStubDir("open");

    const spawned: ChildProcess.StandardCommand[] = [];
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({ editor: "vscode", cwd: "/workspace/repo" });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "darwin",
          env: { PATH: binDir },
          stdoutFor: mdfindStdoutFor(["com.microsoft.VSCode"]),
          onSpawn: (command) => {
            spawned.push(command);
          },
        }),
      ),
    );

    const launch = spawned.find((command) => command.command !== "mdfind");
    assert.ok(launch);
    assert.equal(launch.command, "open");
    assert.deepEqual(launch.args, ["-b", "com.microsoft.VSCode", "/workspace/repo"]);
    assert.equal(launch.options.detached, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("drops line and column when the app bundle launch replaces a missing CLI", () =>
  Effect.gen(function* () {
    const binDir = yield* makeExecutableStubDir("open");

    const spawned: ChildProcess.StandardCommand[] = [];
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "cursor",
        cwd: "/workspace/repo/src/index.ts:12:4",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "darwin",
          env: { PATH: binDir },
          stdoutFor: mdfindStdoutFor(["com.todesktop.230313mzl4w4u92"]),
          onSpawn: (command) => {
            spawned.push(command);
          },
        }),
      ),
    );

    const launch = spawned.find((command) => command.command !== "mdfind");
    assert.ok(launch);
    assert.deepEqual(launch.args, [
      "-b",
      "com.todesktop.230313mzl4w4u92",
      "/workspace/repo/src/index.ts",
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("prefers the CLI over the app bundle so line and column survive", () =>
  Effect.gen(function* () {
    const binDir = yield* makeExecutableStubDir("open", "code");

    const spawned: ChildProcess.StandardCommand[] = [];
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "vscode",
        cwd: "/workspace/repo/src/index.ts:12:4",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "darwin",
          env: { PATH: binDir },
          stdoutFor: mdfindStdoutFor(["com.microsoft.VSCode"]),
          onSpawn: (command) => {
            spawned.push(command);
          },
        }),
      ),
    );

    const launch = spawned.find((command) => command.command !== "mdfind");
    assert.ok(launch);
    assert.equal(launch.command, "code");
    assert.deepEqual(launch.args, ["--goto", "/workspace/repo/src/index.ts:12:4"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects unknown editors through the service API", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const error = yield* launcher
      .launchEditor({ editor: "missing-editor" as never, cwd: "/tmp/workspace" })
      .pipe(Effect.flip);
    assert.instanceOf(error, ExternalLauncher.ExternalLauncherUnknownEditorError);
    assert.equal(error.editor, "missing-editor");
    assert.equal(error.message, "Unknown editor: missing-editor");
  }).pipe(Effect.provide(testLayer({ platform: "linux", env: { PATH: "" } }))),
);
