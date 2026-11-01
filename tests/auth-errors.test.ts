import { describe, expect, test } from "bun:test";
import { authErrorDetail } from "../src/auth-errors";

describe("safe authentication diagnostics", () => {
  test("preserves descriptive browser errors, including cross-realm objects and strings", () => {
    expect(authErrorDetail(new Error("Authorization page could not be loaded."))).toBe(
      "Authorization page could not be loaded.",
    );
    expect(authErrorDetail({ name: "NetworkError", message: "Failed to fetch" })).toBe(
      "NetworkError: Failed to fetch",
    );
    expect(authErrorDetail("User canceled authentication")).toBe("User canceled authentication");
  });

  test("does not serialize raw error objects, stacks or request fields", () => {
    expect(authErrorDetail({ request: "secret", stack: "private" })).toBe("");
    expect(
      authErrorDetail({ message: "Scope not allowed", access_token: "secret", stack: "private" }),
    ).toBe("Scope not allowed");
    expect(
      authErrorDetail({
        get message() {
          throw new Error("private");
        },
      }),
    ).toBe("");
  });

  test("removes URLs, headers and labelled credential fields", () => {
    const detail = authErrorDetail(
      'Invalid redirect https://callback.example/?code=code-secret&state=state-secret Authorization: Bearer bearer-secret refresh_token="refresh-secret" client_secret=client-secret code_verifier:verifier-secret',
    );
    for (const secret of [
      "callback.example",
      "code-secret",
      "state-secret",
      "bearer-secret",
      "refresh-secret",
      "client-secret",
      "verifier-secret",
    ])
      expect(detail).not.toContain(secret);
    expect(detail).toContain("Invalid redirect");
    expect(detail).toContain("[hidden]");
  });

  test("redacts known secrets even without labels and with nested URL encoding", () => {
    const detail = authErrorDetail("Failed with short-secret and short%252Dsecret", [
      "short-secret",
    ]);
    expect(detail).toBe("Failed with [hidden] and [hidden]");
  });

  test("opaque tokens, control characters and excessive diagnostic lengths are bounded", () => {
    expect(authErrorDetail(`Failed with ${"a".repeat(43)}\u202e\nPlease retry`)).toBe(
      "Failed with [hidden] Please retry",
    );
    expect(authErrorDetail("word ".repeat(300)).length).toBeLessThanOrEqual(1_001);
    expect(authErrorDetail("a".repeat(20_000))).toBe("");
  });
});
