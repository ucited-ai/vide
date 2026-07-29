/**
 * Maps an environment's reported OS to the `navigator.platform`-style string
 * the project-path helpers (e.g. {@link isUnsupportedWindowsProjectPath})
 * expect, falling back to the local browser's platform when the environment
 * hasn't reported one yet (e.g. before its server config has loaded).
 */
export function getEnvironmentBrowsePlatform(os: string | null | undefined): string {
  if (os === "windows") {
    return "Win32";
  }
  if (os === "darwin") {
    return "MacIntel";
  }
  if (os === "linux") {
    return "Linux";
  }
  return typeof navigator === "undefined" ? "" : navigator.platform;
}
