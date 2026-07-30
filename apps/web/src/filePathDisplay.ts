import { splitPathAndPosition } from "./terminal-links";

function normalizePathSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

function canonicalizeWindowsDrivePath(path: string): string {
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

function trimTrailingPathSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function stripRelativePrefixes(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function formatWorkspaceRelativePath(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
): string {
  const { path, line, column } = splitPathAndPosition(pathWithPosition);
  const normalizedPath = canonicalizeWindowsDrivePath(normalizePathSeparators(path));

  let displayPath = normalizedPath;
  if (workspaceRoot) {
    const normalizedWorkspaceRoot = canonicalizeWindowsDrivePath(
      normalizePathSeparators(trimTrailingPathSeparators(workspaceRoot)),
    );
    const workspaceLabel = basenameOfPath(normalizedWorkspaceRoot);
    const pathForCompare = normalizedPath.toLowerCase();
    const workspaceForCompare = normalizedWorkspaceRoot.toLowerCase();
    const workspaceWithSeparator = `${workspaceForCompare}/`;
    const workspaceLabelWithSeparator = `${workspaceLabel.toLowerCase()}/`;

    if (pathForCompare === workspaceForCompare) {
      displayPath = workspaceLabel;
    } else if (pathForCompare.startsWith(workspaceWithSeparator)) {
      const relativeSuffix = normalizedPath.slice(normalizedWorkspaceRoot.length + 1);
      displayPath = `${workspaceLabel}/${relativeSuffix}`;
    } else if (!normalizedPath.startsWith("/")) {
      const relativePath = stripRelativePrefixes(normalizedPath);
      displayPath = pathForCompare.startsWith(workspaceLabelWithSeparator)
        ? normalizedPath
        : `${workspaceLabel}/${relativePath}`;
    }
  }

  if (!line) return displayPath;
  return `${displayPath}:${line}${column ? `:${column}` : ""}`;
}

export type WorkspaceRelativePathParts = {
  /** Everything up to and including the final separator. Empty at the root. */
  readonly directory: string;
  /** The file or folder itself, plus any `:line:column` suffix. */
  readonly fileName: string;
};

/**
 * The same display path, split where the eye needs it.
 *
 * A caller that renders the folder muted and the file name in ink cannot do that
 * from one string, and re-deriving the split from a formatted path would put the
 * workspace-relative rules in two places. This shares
 * `formatWorkspaceRelativePath` and only decides where to cut.
 */
export function splitWorkspaceRelativePath(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
): WorkspaceRelativePathParts {
  const displayPath = formatWorkspaceRelativePath(pathWithPosition, workspaceRoot);
  const separatorIndex = displayPath.lastIndexOf("/");
  if (separatorIndex < 0) {
    return { directory: "", fileName: displayPath };
  }
  return {
    directory: displayPath.slice(0, separatorIndex + 1),
    fileName: displayPath.slice(separatorIndex + 1),
  };
}
