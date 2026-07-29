/**
 * Infers a destination folder name for a freshly cloned repository from its
 * remote URL, so a clone can be started with a single URL input instead of
 * asking the user to also type a destination path. Handles HTTPS URLs
 * ("https://github.com/owner/repo.git"), scp-like SSH URLs
 * ("git@github.com:owner/repo.git"), and "ssh://" URLs alike.
 */
export function inferRepositoryFolderNameFromRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return "repository";
  }

  const withoutTrailingSlashes = trimmed.replace(/\/+$/, "");
  const withoutGitSuffix = withoutTrailingSlashes.replace(/\.git$/i, "");
  const lastSegment = withoutGitSuffix.split(/[/:]/).pop()?.trim() ?? "";
  return lastSegment.length > 0 ? lastSegment : "repository";
}
