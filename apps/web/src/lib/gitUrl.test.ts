import { describe, expect, it } from "vite-plus/test";
import { inferRepositoryFolderNameFromRemoteUrl } from "./gitUrl";

describe("inferRepositoryFolderNameFromRemoteUrl", () => {
  it("infers the repo name from an https URL", () => {
    expect(inferRepositoryFolderNameFromRemoteUrl("https://github.com/owner/repo.git")).toBe(
      "repo",
    );
  });

  it("infers the repo name from a scp-like ssh URL", () => {
    expect(inferRepositoryFolderNameFromRemoteUrl("git@github.com:owner/repo.git")).toBe("repo");
  });

  it("infers the repo name from an ssh:// URL with a port", () => {
    expect(inferRepositoryFolderNameFromRemoteUrl("ssh://git@github.com:22/owner/repo.git")).toBe(
      "repo",
    );
  });

  it("strips a trailing slash", () => {
    expect(inferRepositoryFolderNameFromRemoteUrl("https://github.com/owner/repo/")).toBe("repo");
  });

  it("handles urls without a .git suffix", () => {
    expect(inferRepositoryFolderNameFromRemoteUrl("https://github.com/owner/repo")).toBe("repo");
  });

  it("falls back to a default name for an empty or unparseable url", () => {
    expect(inferRepositoryFolderNameFromRemoteUrl("   ")).toBe("repository");
  });
});
