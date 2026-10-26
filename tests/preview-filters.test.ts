import { expect, test } from "bun:test";
import {
  createPreviewFilter,
  normalizeDomainList,
  normalizeUserList,
} from "../src/preview-filters";

test("usernames accept @, separators and mixed case without duplicates", () => {
  expect(normalizeUserList("@Some_User, OTHER; some_user\nthird-user")).toEqual([
    "some_user",
    "other",
    "third-user",
  ]);
  expect(normalizeUserList([null, 12, "", "@", "invalid/name", "@USER"])).toEqual(["user"]);
});

test("domains accept URLs, subdomain wildcards and IDNs, ignoring invalid entries", () => {
  expect(
    normalizeDomainList(
      "Example.COM, https://example.com/path; *.cdn.site\nhttps://пример.рф/test",
    ),
  ).toEqual(["example.com", "cdn.site", "xn--e1afmkfd.xn--p1ai"]);
  expect(
    normalizeDomainList([
      null,
      1,
      "https://",
      "javascript:alert(1)",
      "ftp://example.com",
      "https://user:pass@example.com",
      "bad..host",
    ]),
  ).toEqual([]);
});

test("user exclusions match the full username case-insensitively", () => {
  const filter = createPreviewFilter({
    blockedUsers: ["@Alice"],
    blockedDomains: [],
    hideBots: false,
  });
  expect(filter.blocksAuthor("ALICE")).toBe(true);
  expect(filter.blocksAuthor("alice2")).toBe(false);
  expect(filter.blocksAuthor("")).toBe(false);
});

test("domain exclusions include subdomains but not suffix lookalikes", () => {
  const filter = createPreviewFilter({
    blockedUsers: [],
    blockedDomains: ["example.com"],
    hideBots: false,
  });
  for (const url of [
    "https://example.com/photo",
    "https://cdn.example.com/a",
    "http://A.B.EXAMPLE.COM.:8080/x",
  ])
    expect(filter.blocksUrl(url)).toBe(true);
  for (const url of [
    "https://notexample.com/x",
    "https://example.com.evil.test/x",
    "https://allowed.test/example.com",
    "broken",
  ])
    expect(filter.blocksUrl(url)).toBe(false);
});

test("bot filtering is optional and does not guess from a nickname suffix", () => {
  const filter = createPreviewFilter({ blockedUsers: [], blockedDomains: [], hideBots: true });
  expect(filter.blocksAuthor("Nightbot")).toBe(true);
  expect(filter.blocksAuthor("StreamElements")).toBe(true);
  expect(filter.blocksAuthor("CustomService", true)).toBe(true);
  expect(filter.blocksAuthor("humanbot")).toBe(false);
  const disabled = createPreviewFilter({ blockedUsers: [], blockedDomains: [], hideBots: false });
  expect(disabled.blocksAuthor("Nightbot", true)).toBe(false);
});
