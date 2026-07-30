/**
 * ExternalLauncher - external application launch service interface.
 *
 * Owns process launch helpers for browser URLs and workspace paths
 * in configured editor integrations.
 *
 * @module ExternalLauncher
 */
import {
  EDITORS,
  ExternalLauncherError,
  ExternalLauncherBrowserSpawnError,
  ExternalLauncherCommandNotFoundError,
  ExternalLauncherEditorSpawnError,
  ExternalLauncherUnknownEditorError,
  ExternalLauncherUnsupportedEditorError,
  type EditorId,
  type LaunchEditorInput,
} from "@vide/contracts";
import { HostProcessPlatform } from "@vide/shared/hostProcess";
import { isCommandAvailable, resolveSpawnCommand } from "@vide/shared/shell";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";

// ==============================
// Definitions
// ==============================

export {
  ExternalLauncherError,
  ExternalLauncherBrowserSpawnError,
  ExternalLauncherCommandNotFoundError,
  ExternalLauncherEditorSpawnError,
  ExternalLauncherUnknownEditorError,
  ExternalLauncherUnsupportedEditorError,
  isExternalLauncherError,
} from "@vide/contracts";
export type { LaunchEditorInput };
interface EditorLaunch {
  readonly editor: EditorId;
  readonly target: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

interface ProcessLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: ChildProcess.CommandOptions;
}

interface TargetPathAndPosition {
  readonly path: string;
  readonly line: string;
  readonly column: Option.Option<string>;
}

const TARGET_WITH_POSITION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;
const MAC_OPEN_COMMAND = "open";
const MAC_APP_PROBE_COMMAND = "mdfind";
const MAC_APP_BUNDLE_ID_ATTRIBUTE = "kMDItemCFBundleIdentifier";
/** Matches one `<path>    kMDItemCFBundleIdentifier = <id>` line of `mdfind -attr` output. */
const MAC_APP_BUNDLE_ID_PATTERN = new RegExp(`${MAC_APP_BUNDLE_ID_ATTRIBUTE}\\s*=\\s*(\\S+)\\s*$`);
/** Well under the discovery timeout in ws.ts, which drops the whole result when it overruns. */
const MAC_APP_PROBE_TIMEOUT = Duration.seconds(3);
const MAC_APP_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
const NO_INSTALLED_APP_BUNDLE_IDS: ReadonlySet<string> = new Set();
const POWERSHELL_ARGUMENTS_PREFIX = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
] as const;

const DETACHED_IGNORE_STDIO_OPTIONS = {
  detached: true,
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
} as const satisfies ChildProcess.CommandOptions;

const compactEnv = (input: Record<string, Option.Option<string>>): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      Option.match(value, {
        onNone: () => [],
        onSome: (resolved) => [[key, resolved]],
      }),
    ),
  );

const BrowserLaunchEnvConfig = Config.all({
  SYSTEMROOT: Config.string("SYSTEMROOT").pipe(Config.option),
  windir: Config.string("windir").pipe(Config.option),
  WSL_DISTRO_NAME: Config.string("WSL_DISTRO_NAME").pipe(Config.option),
  WSL_INTEROP: Config.string("WSL_INTEROP").pipe(Config.option),
  SSH_CONNECTION: Config.string("SSH_CONNECTION").pipe(Config.option),
  SSH_TTY: Config.string("SSH_TTY").pipe(Config.option),
  container: Config.string("container").pipe(Config.option),
}).pipe(Config.map(compactEnv));

const CommandLookupEnvConfig = Config.all({
  PATH: Config.string("PATH").pipe(Config.option),
  Path: Config.string("Path").pipe(Config.option),
  path: Config.string("path").pipe(Config.option),
  PATHEXT: Config.string("PATHEXT").pipe(Config.option),
}).pipe(Config.map(compactEnv));

const readBrowserLaunchEnv = BrowserLaunchEnvConfig.pipe(Effect.orElseSucceed(() => ({})));
const readCommandLookupEnv = CommandLookupEnvConfig.pipe(Effect.orElseSucceed(() => ({})));

function parseTargetPathAndPosition(target: string): Option.Option<TargetPathAndPosition> {
  const match = TARGET_WITH_POSITION_PATTERN.exec(target);
  if (!match?.[1] || !match[2]) {
    return Option.none();
  }

  return Option.some({
    path: match[1],
    line: match[2],
    column: Option.fromUndefinedOr(match[3]),
  });
}

function resolveCommandEditorArgs(
  editor: (typeof EDITORS)[number],
  target: string,
): ReadonlyArray<string> {
  const parsedTarget = parseTargetPathAndPosition(target);

  switch (editor.launchStyle) {
    case "direct-path":
      return [target];
    case "goto":
      return Option.isSome(parsedTarget) ? ["--goto", target] : [target];
    case "line-column":
      return Option.match(parsedTarget, {
        onNone: () => [target],
        onSome: ({ path, line, column }) => [
          "--line",
          line,
          ...Option.match(column, {
            onNone: () => [],
            onSome: (value) => ["--column", value],
          }),
          path,
        ],
      });
  }
}

function resolveEditorArgs(
  editor: (typeof EDITORS)[number],
  target: string,
): ReadonlyArray<string> {
  const baseArgs = "baseArgs" in editor ? editor.baseArgs : [];
  return [...baseArgs, ...resolveCommandEditorArgs(editor, target)];
}

const resolveAvailableCommand = Effect.fn("externalLauncher.resolveAvailableCommand")(function* (
  commands: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> {
  for (const command of commands) {
    if (yield* isCommandAvailable(command, { env })) {
      return Option.some(command);
    }
  }
  return Option.none();
});

function editorAppBundleId(editor: (typeof EDITORS)[number]): string | undefined {
  return "appBundleId" in editor ? editor.appBundleId : undefined;
}

function buildAppBundleIdQuery(bundleIds: ReadonlyArray<string>): string {
  // Spotlight compares bundle identifiers case-sensitively unless the value
  // carries the trailing `c` modifier, so a vendor re-casing its identifier
  // would otherwise silently turn detection off.
  return bundleIds.map((id) => `${MAC_APP_BUNDLE_ID_ATTRIBUTE} == '${id}'c`).join(" || ");
}

function parseAppBundleIds(stdout: string): ReadonlySet<string> {
  const installed = new Set<string>();
  for (const line of stdout.split("\n")) {
    const bundleId = MAC_APP_BUNDLE_ID_PATTERN.exec(line)?.[1];
    if (bundleId) {
      installed.add(bundleId.toLowerCase());
    }
  }
  return installed;
}

/**
 * Reports which of `bundleIds` are installed as `.app` bundles on this Mac.
 *
 * Uses a single batched Spotlight query rather than one probe per editor: it
 * finds bundles wherever they live (`/Applications`, `~/Applications`, a custom
 * folder) instead of hardcoding install paths, costs one child process for the
 * whole table, and — unlike `open -R` — never touches LaunchServices or Finder.
 * A failing or slow probe degrades to "nothing installed", leaving the caller
 * with the `PATH` result it would have had anyway.
 */
const resolveInstalledAppBundleIds = Effect.fn("externalLauncher.resolveInstalledAppBundleIds")(
  function* (
    platform: NodeJS.Platform,
    bundleIds: ReadonlyArray<string>,
  ): Effect.fn.Return<ReadonlySet<string>, never, ProcessRunner.ProcessRunner> {
    if (platform !== "darwin" || bundleIds.length === 0) {
      return NO_INSTALLED_APP_BUNDLE_IDS;
    }

    const processRunner = yield* ProcessRunner.ProcessRunner;
    const result = yield* processRunner
      .run({
        command: MAC_APP_PROBE_COMMAND,
        args: ["-attr", MAC_APP_BUNDLE_ID_ATTRIBUTE, buildAppBundleIdQuery(bundleIds)],
        timeout: MAC_APP_PROBE_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: MAC_APP_PROBE_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(Effect.orElseSucceed(() => null));

    return result === null ? NO_INSTALLED_APP_BUNDLE_IDS : parseAppBundleIds(result.stdout);
  },
);

function encodeUtf16LeBase64(input: string): string {
  const bytes = new Uint8Array(input.length * 2);
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  return Encoding.encodeBase64(bytes);
}

function escapePowerShellStringLiteral(input: string): string {
  return `'${input.replaceAll("'", "''")}'`;
}

function resolvePowerShellPath(env: NodeJS.ProcessEnv = {}): string {
  return `${env.SYSTEMROOT || env.windir || String.raw`C:\Windows`}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function resolveWslPowerShellPath(): string {
  return "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
}

function shouldUseWindowsBrowserFromWsl(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): boolean {
  return (
    platform === "linux" &&
    (env.WSL_DISTRO_NAME !== undefined || env.WSL_INTEROP !== undefined) &&
    env.SSH_CONNECTION === undefined &&
    env.SSH_TTY === undefined &&
    env.container === undefined
  );
}

function resolveWindowsBrowserLaunch(target: string, command: string): ProcessLaunch {
  const encodedCommand = encodeUtf16LeBase64(
    `$ProgressPreference = 'SilentlyContinue'; Start ${escapePowerShellStringLiteral(target)}`,
  );
  return {
    command,
    args: [...POWERSHELL_ARGUMENTS_PREFIX, encodedCommand],
    options: {
      detached: true,
      shell: false,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  };
}

function fileManagerCommandForPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

function buildBrowserLaunch(
  target: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): ProcessLaunch {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [target],
      options: DETACHED_IGNORE_STDIO_OPTIONS,
    };
  }

  if (platform === "win32") {
    return resolveWindowsBrowserLaunch(target, resolvePowerShellPath(env));
  }

  if (shouldUseWindowsBrowserFromWsl(platform, env)) {
    return resolveWindowsBrowserLaunch(target, resolveWslPowerShellPath());
  }

  return {
    command: "xdg-open",
    args: [target],
    options: DETACHED_IGNORE_STDIO_OPTIONS,
  };
}

const buildAvailableEditors = Effect.fn("externalLauncher.buildAvailableEditors")(function* (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ReadonlyArray<EditorId>,
  never,
  FileSystem.FileSystem | Path.Path | ProcessRunner.ProcessRunner
> {
  const installedBundleIds = yield* resolveInstalledAppBundleIds(
    platform,
    EDITORS.flatMap((editor) => {
      const bundleId = editorAppBundleId(editor);
      return bundleId ? [bundleId] : [];
    }),
  );
  const available: EditorId[] = [];

  for (const editor of EDITORS) {
    if (editor.commands === null) {
      const command = fileManagerCommandForPlatform(platform);
      if (yield* isCommandAvailable(command, { env })) {
        available.push(editor.id);
      }
      continue;
    }

    const command = yield* resolveAvailableCommand(editor.commands, env);
    if (Option.isSome(command)) {
      available.push(editor.id);
      continue;
    }

    const bundleId = editorAppBundleId(editor);
    if (bundleId && installedBundleIds.has(bundleId.toLowerCase())) {
      available.push(editor.id);
    }
  }

  return available;
});

const resolveBrowserLaunch = Effect.fn("externalLauncher.resolveBrowserLaunch")(function* (
  target: string,
) {
  const platform = yield* HostProcessPlatform;
  const env = yield* readBrowserLaunchEnv;
  return buildBrowserLaunch(target, platform, env);
});

const resolveAvailableEditors = Effect.fn("externalLauncher.resolveAvailableEditors")(function* () {
  const platform = yield* HostProcessPlatform;
  const env = yield* readCommandLookupEnv;
  return yield* buildAvailableEditors(platform, env);
});

/**
 * ExternalLauncher - Service tag for browser/editor launch operations.
 */
export class ExternalLauncher extends Context.Service<
  ExternalLauncher,
  {
    readonly resolveAvailableEditors: () => Effect.Effect<ReadonlyArray<EditorId>>;
    /** Launch a URL target in the default browser. */
    readonly launchBrowser: (target: string) => Effect.Effect<void, ExternalLauncherError>;
    /**
     * Launch a workspace path in a selected editor integration.
     *
     * Launches the editor as a detached process so server startup is not blocked.
     */
    readonly launchEditor: (input: LaunchEditorInput) => Effect.Effect<void, ExternalLauncherError>;
  }
>()("vide/process/externalLauncher") {}

// ==============================
// Implementations
// ==============================

/**
 * Builds an `open -b` launch for editors that are installed as a `.app` but
 * expose no CLI.
 *
 * `open` has no equivalent of `code --goto`, so any `:line:column` suffix is
 * dropped and the plain path is handed to the editor: the file (or folder) is
 * opened in a new window, but the caret is not moved to the requested position.
 */
const resolveAppBundleLaunch = Effect.fn("externalLauncher.resolveAppBundleLaunch")(function* (
  editor: (typeof EDITORS)[number],
  target: string,
  platform: NodeJS.Platform,
): Effect.fn.Return<Option.Option<EditorLaunch>, never, ProcessRunner.ProcessRunner> {
  const bundleId = editorAppBundleId(editor);
  if (platform !== "darwin" || !bundleId) {
    return Option.none();
  }

  const installedBundleIds = yield* resolveInstalledAppBundleIds(platform, [bundleId]);
  if (!installedBundleIds.has(bundleId.toLowerCase())) {
    return Option.none();
  }

  const path = Option.match(parseTargetPathAndPosition(target), {
    onNone: () => target,
    onSome: (parsed) => parsed.path,
  });
  return Option.some({
    editor: editor.id,
    target,
    command: MAC_OPEN_COMMAND,
    args: ["-b", bundleId, path],
  });
});

const resolveEditorLaunch = Effect.fn("resolveEditorLaunch")(function* (
  input: LaunchEditorInput,
): Effect.fn.Return<
  EditorLaunch,
  ExternalLauncherError,
  FileSystem.FileSystem | Path.Path | ProcessRunner.ProcessRunner
> {
  const platform = yield* HostProcessPlatform;
  const env = yield* readCommandLookupEnv;
  yield* Effect.annotateCurrentSpan({
    "externalLauncher.editor": input.editor,
    "externalLauncher.cwd": input.cwd,
    "externalLauncher.platform": platform,
  });
  const editorDef = EDITORS.find((editor) => editor.id === input.editor);
  if (!editorDef) {
    return yield* new ExternalLauncherUnknownEditorError({ editor: input.editor });
  }

  if (editorDef.commands) {
    const command = yield* resolveAvailableCommand(editorDef.commands, env);
    if (Option.isSome(command)) {
      return {
        editor: editorDef.id,
        target: input.cwd,
        command: command.value,
        args: resolveEditorArgs(editorDef, input.cwd),
      };
    }

    const bundleLaunch = yield* resolveAppBundleLaunch(editorDef, input.cwd, platform);
    if (Option.isSome(bundleLaunch)) {
      return bundleLaunch.value;
    }

    return {
      editor: editorDef.id,
      target: input.cwd,
      command: editorDef.commands[0],
      args: resolveEditorArgs(editorDef, input.cwd),
    };
  }

  if (editorDef.id !== "file-manager") {
    return yield* new ExternalLauncherUnsupportedEditorError({ editor: input.editor });
  }

  return {
    editor: editorDef.id,
    target: input.cwd,
    command: fileManagerCommandForPlatform(platform),
    args: [input.cwd],
  };
});

const launchAndUnref = Effect.fn("externalLauncher.launchAndUnref")(function* (
  launch: ProcessLaunch,
  onError: (cause: unknown) => ExternalLauncherError,
): Effect.fn.Return<void, ExternalLauncherError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(launch.command, launch.args, launch.options);

  yield* spawner.spawn(command).pipe(
    Effect.flatMap((handle) => handle.unref),
    Effect.asVoid,
    Effect.scoped,
    Effect.mapError(onError),
  );
});

const launchBrowser = Effect.fn("externalLauncher.launchBrowser")(function* (
  target: string,
): Effect.fn.Return<void, ExternalLauncherError, ChildProcessSpawner.ChildProcessSpawner> {
  const launch = yield* resolveBrowserLaunch(target);
  return yield* launchAndUnref(
    launch,
    (cause) =>
      new ExternalLauncherBrowserSpawnError({
        target,
        command: launch.command,
        args: launch.args,
        cause,
      }),
  );
});

const launchEditorProcess = Effect.fn("externalLauncher.launchEditorProcess")(function* (
  launch: EditorLaunch,
): Effect.fn.Return<
  void,
  ExternalLauncherError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const env = yield* readCommandLookupEnv;
  if (!(yield* isCommandAvailable(launch.command, { env }))) {
    return yield* new ExternalLauncherCommandNotFoundError({
      editor: launch.editor,
      command: launch.command,
    });
  }

  const spawnCommand = yield* resolveSpawnCommand(launch.command, launch.args, { env });
  yield* launchAndUnref(
    {
      command: spawnCommand.command,
      args: spawnCommand.args,
      options: {
        detached: true,
        shell: spawnCommand.shell,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    },
    (cause) =>
      new ExternalLauncherEditorSpawnError({
        editor: launch.editor,
        target: launch.target,
        command: spawnCommand.command,
        args: spawnCommand.args,
        cause,
      }),
  );
});

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.make();

  const provideCommandResolutionServices = <A, E, R>(
    effect: Effect.Effect<
      A,
      E,
      R | FileSystem.FileSystem | Path.Path | ProcessRunner.ProcessRunner
    >,
  ) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
    );

  return ExternalLauncher.of({
    resolveAvailableEditors: () => provideCommandResolutionServices(resolveAvailableEditors()),
    launchBrowser: (target) =>
      launchBrowser(target).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
    launchEditor: (input) =>
      provideCommandResolutionServices(
        Effect.flatMap(resolveEditorLaunch(input), (launch) =>
          launchEditorProcess(launch).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(ExternalLauncher, make);
