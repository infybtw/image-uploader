import { describe, expect, test } from "bun:test";
import { checkReleaseVersion } from "../scripts/check-release";
import metadata from "../package.json";

describe("release versions", () => {
  test("project versions agree and match the release tag", () => {
    expect(checkReleaseVersion()).toBe(metadata.version);
    expect(checkReleaseVersion(`v${metadata.version}`)).toBe(metadata.version);
  });

  test("accepts the next stable version without hardcoded test changes", () => {
    expect(checkReleaseVersion("v1.2.3", "1.2.3", "1.2.3")).toBe("1.2.3");
  });

  test("rejects inconsistent package and extension versions", () => {
    expect(() => checkReleaseVersion(undefined, "1.2.3", "1.2.2")).toThrow("must match");
  });

  for (const tag of ["1.2.3", "v1.2.4", "v1.2.3-beta.1", "v1.2.3+build", ""]) {
    test(`rejects mismatched tag ${JSON.stringify(tag)}`, () => {
      expect(() => checkReleaseVersion(tag, "1.2.3", "1.2.3")).toThrow("Release tag");
    });
  }

  for (const version of ["1.2", "01.2.3", "1.2.3.4", "1.2.3-beta.1", "1.2.3+build", "65536.0.0"]) {
    test(`rejects unsupported version ${version}`, () => {
      expect(() => checkReleaseVersion(undefined, version, version)).toThrow();
    });
  }
});
