import { describe, expect, mock, test } from "bun:test";
import {
  createTwirAuth,
  pkceChallenge,
  TWIR_CLIENT_ID,
  TWIR_RESOURCE,
  TWIR_SCOPE,
  type AuthRecord,
  type AuthSession,
  type AuthStore,
} from "../src/twir-auth";

const redirect = "https://extension.chromiumapp.org/";
const client = { id: TWIR_CLIENT_ID, redirectUri: redirect };
const tokens = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "files:edit",
};

function setup(
  options: {
    record?: AuthRecord;
    session?: AuthSession;
    response?: (url: string, init: RequestInit) => Promise<Response>;
    launch?: (url: string) => Promise<string | undefined>;
  } = {},
) {
  let record = structuredClone(options.record ?? {});
  let session = structuredClone(options.session ?? {});
  let now = 1_000_000;
  const store: AuthStore = {
    async read() {
      return structuredClone(record);
    },
    async write(value) {
      record = structuredClone(value);
    },
    async readSession() {
      return structuredClone(session);
    },
    async writeSession(value) {
      session = structuredClone(value);
    },
  };
  const fetcher = mock(async (url: string, init: RequestInit) => {
    if (options.response) return options.response(url, init);
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    return Response.json(tokens);
  });
  const launch = mock(
    options.launch ??
      (async (value: string) => {
        const url = new URL(value);
        return `${redirect}?code=one-time-code&state=${url.searchParams.get("state")}`;
      }),
  );
  const auth = createTwirAuth({
    store,
    fetcher,
    launch,
    redirectUri: () => redirect,
    now: () => now,
  });
  return {
    auth,
    store,
    fetcher,
    launch,
    record: () => record,
    session: () => session,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("Twir OAuth", () => {
  test("PKCE uses the RFC 7636 S256 test vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("unconnected installs are anonymous without registration or network activity", async () => {
    const { auth, fetcher, launch } = setup();
    expect(await auth.status()).toBe("disconnected");
    expect(await auth.accessToken()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  test("uses the configured public client without registration, verifies PKCE and stores credentials outside public state", async () => {
    const { auth, fetcher, launch, record, session } = setup();
    await auth.connect();
    expect(await auth.status()).toBe("connected");
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/register"))).toBe(false);
    const url = new URL(launch.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe("https://twir.app/api/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(TWIR_CLIENT_ID);
    expect(url.searchParams.get("resource")).toBe(TWIR_RESOURCE);
    expect(url.searchParams.get("scope")).toBe(TWIR_SCOPE);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exchange = fetcher.mock.calls.find(([path]) => path.endsWith("/token"))![1];
    const body = exchange.body as URLSearchParams;
    expect(body.get("client_id")).toBe(client.id);
    expect(body.get("redirect_uri")).toBe(redirect);
    expect(body.get("code")).toBe("one-time-code");
    expect(body.get("resource")).toBe(TWIR_RESOURCE);
    expect(await pkceChallenge(body.get("code_verifier")!)).toBe(
      url.searchParams.get("code_challenge")!,
    );
    expect(record().grant?.refreshToken).toBe(tokens.refresh_token);
    expect(JSON.stringify(record())).not.toContain(tokens.access_token);
    expect(session().access?.token).toBe(tokens.access_token);
    expect(session().attempt).toBeUndefined();
    expect(JSON.stringify(await auth.status())).not.toContain("token");
    for (const [, init] of fetcher.mock.calls) {
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(String(init.body)).not.toContain("client_secret");
    }
    expect((await auth.accessToken())?.token).toBe(tokens.access_token);
    expect(fetcher.mock.calls.filter(([path]) => path.endsWith("/token"))).toHaveLength(1);
    await auth.disconnect();
    await auth.connect();
    expect(fetcher.mock.calls.filter(([path]) => path.endsWith("/register"))).toHaveLength(0);
  });

  for (const callback of [
    "https://evil.com/?code=secret&state=STATE",
    `${redirect}wrong?code=secret&state=STATE`,
    `${redirect}?code=secret&state=bad`,
    `${redirect}?code=secret`,
    `${redirect}?code=secret&state=STATE#extra`,
    `${redirect}?code=a&code=b&state=STATE`,
    `${redirect}?code=a&state=STATE&state=STATE`,
    `${redirect}?error=access_denied&error_description=secret&state=STATE`,
    undefined,
  ]) {
    test(`rejects an invalid or denied callback (${callback?.split("?")[0] ?? "missing"})`, async () => {
      const { auth, fetcher, record, session } = setup({
        record: { client },
        launch: async (value) =>
          callback?.replaceAll("STATE", new URL(value).searchParams.get("state")!),
      });
      await expect(auth.connect()).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(record().grant).toBeUndefined();
      expect(session().attempt).toBeUndefined();
    });
  }

  test("shows the browser's actual cancellation reason and clears the pending attempt", async () => {
    const { auth, session } = setup({
      record: { client },
      launch: async () => {
        throw new Error("The user canceled the authentication.");
      },
    });
    await expect(auth.connect()).rejects.toThrow(
      "Twir sign-in failed (browser): The user canceled the authentication.",
    );
    expect(session().attempt).toBeUndefined();
    expect(await auth.status()).toBe("disconnected");
  });

  test("does not accept expired callbacks", async () => {
    const ready = Promise.withResolvers<void>();
    let value = "";
    const env = setup({
      record: { client },
      launch: async (url) => {
        value = url;
        await ready.promise;
        return `${redirect}?code=a&state=${new URL(value).searchParams.get("state")}`;
      },
    });
    const pending = env.auth.connect();
    // Let the pending attempt be stored before advancing the clock.
    await env.auth.status();
    await env.auth.status();
    env.advance(11 * 60_000);
    ready.resolve();
    await expect(pending).rejects.toThrow("expired");
    expect(env.fetcher).not.toHaveBeenCalled();
  });

  test("disconnect during sign-in invalidates the callback and permits no anonymous upload while connecting", async () => {
    const opened = Promise.withResolvers<string>();
    const callback = Promise.withResolvers<string>();
    const env = setup({
      record: { client },
      launch: (url) => {
        opened.resolve(url);
        return callback.promise;
      },
    });
    const pending = env.auth.connect();
    const url = new URL(await opened.promise);
    expect(await env.auth.status()).toBe("connecting");
    await expect(env.auth.accessToken()).rejects.toThrow("Finish connecting");
    await expect(env.auth.connect()).rejects.toThrow("already open");
    await env.auth.disconnect();
    callback.resolve(`${redirect}?code=a&state=${url.searchParams.get("state")}`);
    await expect(pending).rejects.toThrow("canceled");
    expect(await env.auth.status()).toBe("disconnected");
    expect(env.fetcher).not.toHaveBeenCalled();
  });

  test("refreshes after a browser restart and persists a rotated refresh token", async () => {
    const { auth, record, fetcher } = setup({
      record: { client, grant: { id: "grant", refreshToken: "old-refresh" } },
    });
    expect((await auth.accessToken())?.token).toBe(tokens.access_token);
    const body = fetcher.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("resource")).toBe(TWIR_RESOURCE);
    expect(record().grant?.refreshToken).toBe(tokens.refresh_token);
  });

  test("concurrent uploads share one refresh and refresh before expiry", async () => {
    const env = setup({ record: { client, grant: { id: "grant", refreshToken: "old-refresh" } } });
    const results = await Promise.all([
      env.auth.accessToken(),
      env.auth.accessToken(),
      env.auth.accessToken(),
    ]);
    expect(new Set(results.map((r) => r?.token)).size).toBe(1);
    expect(env.fetcher).toHaveBeenCalledTimes(1);
    env.advance(3541_000);
    await env.auth.accessToken();
    expect(env.fetcher).toHaveBeenCalledTimes(2);
  });

  test("invalid refresh keeps a durable reconnect marker, never anonymous mode", async () => {
    const { auth, record, fetcher } = setup({
      record: { client, grant: { id: "grant", refreshToken: "revoked" } },
      response: async () =>
        Response.json({ error: "invalid_grant", error_description: "secret" }, { status: 400 }),
    });
    await expect(auth.accessToken()).rejects.toThrow("Reconnect Twir");
    expect(record().grant?.needsReconnect).toBe(true);
    expect(record().grant?.refreshToken).toBe("revoked");
    expect(await auth.status()).toBe("reconnect-required");
    await expect(auth.accessToken()).rejects.toThrow("Reconnect Twir");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("network errors preserve the refresh token for a later manual attempt", async () => {
    const { auth, record } = setup({
      record: { client, grant: { id: "grant", refreshToken: "refresh" } },
      response: async () => {
        throw new Error("sensitive-request");
      },
    });
    await expect(auth.accessToken()).rejects.toThrow("Could not reach Twir");
    expect(record().grant?.refreshToken).toBe("refresh");
  });

  for (const invalid of [
    { ...tokens, scope: "files:read" },
    { ...tokens, access_token: "bad\r\nheader" },
    { ...tokens, token_type: "Basic" },
    { ...tokens, expires_in: -1 },
    { ...tokens, expires_in: 1.1 },
    { ...tokens, refresh_token: "" },
  ]) {
    test("rejects malformed tokens or missing upload permission", async () => {
      const { auth } = setup({ record: { client }, response: async () => Response.json(invalid) });
      await expect(auth.connect()).rejects.toThrow("invalid token response");
      expect(await auth.status()).toBe("disconnected");
    });
  }

  test("a rejected access token blocks uploads; stale errors cannot disconnect another grant", async () => {
    const env = setup({ record: { client, grant: { id: "grant", refreshToken: "refresh" } } });
    const access = (await env.auth.accessToken())!;
    await env.auth.rejectAccess({ ...access, grantId: "old-grant" });
    expect(await env.auth.status()).toBe("connected");
    await env.auth.rejectAccess({ ...access, token: "old-access" });
    expect(await env.auth.status()).toBe("connected");
    await env.auth.rejectAccess(access);
    expect(await env.auth.status()).toBe("reconnect-required");
    await expect(env.auth.accessToken()).rejects.toThrow("Reconnect Twir");
  });

  test("logout is local-first and attempts to revoke both tokens even when offline", async () => {
    const env = setup({
      record: { client, grant: { id: "grant", refreshToken: "refresh" } },
      session: { access: { grantId: "grant", token: "access", expiresAt: 9_999_999 } },
      response: async () => {
        expect(env.record().grant).toBeUndefined();
        expect(env.session()).toEqual({});
        throw new Error("offline");
      },
    });
    expect(await env.auth.disconnect()).toEqual({ revoked: false });
    expect(await env.auth.status()).toBe("disconnected");
    expect(await env.auth.accessToken()).toBeNull();
    expect(env.record().client).toEqual(client);
    expect(env.fetcher).toHaveBeenCalledTimes(2);
  });

  test("logout after a rejected access token still revokes the disabled grant", async () => {
    const env = setup({ record: { client, grant: { id: "grant", refreshToken: "refresh" } } });
    const access = (await env.auth.accessToken())!;
    await env.auth.rejectAccess(access);
    await expect(env.auth.accessToken()).rejects.toThrow("Reconnect Twir");
    expect(await env.auth.disconnect()).toEqual({ revoked: true });
    const revoked = env.fetcher.mock.calls
      .filter(([url]) => url.endsWith("/revoke"))
      .map(([, init]) => (init.body as URLSearchParams).get("token"));
    expect(revoked.sort()).toEqual([tokens.access_token, tokens.refresh_token].sort());
  });

  test("a failed access-cache save disables a committed login before revoking its tokens", async () => {
    const env = setup({ record: { client } });
    const writeSession = env.store.writeSession;
    let fail = true;
    env.store.writeSession = async (session) => {
      if (session.access?.token === tokens.access_token && fail) {
        fail = false;
        throw new Error("session storage temporarily unavailable");
      }
      await writeSession(session);
    };
    await expect(env.auth.connect()).rejects.toThrow("Could not save");
    expect(await env.auth.status()).toBe("reconnect-required");
    await expect(env.auth.accessToken()).rejects.toThrow("Reconnect Twir");
    expect(env.record().grant?.needsReconnect).toBe(true);
    expect(env.fetcher.mock.calls.filter(([url]) => url.endsWith("/revoke"))).toHaveLength(2);
  });

  test("storage errors fail closed instead of silently uploading anonymously", async () => {
    const env = setup();
    env.store.read = async () => {
      throw new Error("storage unavailable");
    };
    await expect(env.auth.accessToken()).rejects.toThrow("storage unavailable");
    expect(env.fetcher).not.toHaveBeenCalled();
  });

  for (const oldClient of [
    { id: "old-dynamic-client", redirectUri: redirect },
    { id: TWIR_CLIENT_ID, redirectUri: "https://previous-extension.chromiumapp.org/" },
  ]) {
    test("legacy clients/callbacks cannot use cached access or refresh under the configured app", async () => {
      const env = setup({
        record: { client: oldClient, grant: { id: "legacy", refreshToken: "old-refresh" } },
        session: { access: { grantId: "legacy", token: "old-access", expiresAt: 9_999_999 } },
        launch: async () => {
          throw new Error("canceled");
        },
      });
      expect(await env.auth.status()).toBe("reconnect-required");
      await expect(env.auth.accessToken()).rejects.toThrow("Reconnect Twir");
      expect(env.fetcher).not.toHaveBeenCalled();
      await expect(env.auth.connect()).rejects.toThrow("canceled");
      expect(env.record().client).toEqual(oldClient);
      expect(env.record().grant?.refreshToken).toBe("old-refresh");
      await env.auth.disconnect();
      expect(env.fetcher.mock.calls).toHaveLength(2);
      for (const [, init] of env.fetcher.mock.calls)
        expect((init.body as URLSearchParams).get("client_id")).toBe(oldClient.id);
    });
  }

  test("a successful migration revokes legacy credentials with their original client ID", async () => {
    const env = setup({
      record: {
        client: { id: "old-dynamic-client", redirectUri: redirect },
        grant: { id: "legacy", refreshToken: "old-refresh" },
      },
      session: { access: { grantId: "legacy", token: "old-access", expiresAt: 9_999_999 } },
    });
    await env.auth.connect();
    expect(env.record().client?.id).toBe(TWIR_CLIENT_ID);
    expect(await env.auth.status()).toBe("connected");
    for (const [url, init] of env.fetcher.mock.calls) {
      expect(url).not.toEndWith("/register");
      expect((init.body as URLSearchParams).get("client_id")).toBe(
        url.endsWith("/revoke") ? "old-dynamic-client" : TWIR_CLIENT_ID,
      );
    }
    expect(env.fetcher.mock.calls.filter(([url]) => url.endsWith("/revoke"))).toHaveLength(2);
  });

  test("pending attempts from the old dynamically registered app are discarded after upgrade", async () => {
    const env = setup({
      session: {
        attempt: {
          id: "legacy-attempt",
          state: "old-state",
          verifier: "old-verifier",
          client: { id: "old-dynamic-client", redirectUri: redirect },
          expiresAt: 9_999_999,
        },
      },
    });
    expect(await env.auth.status()).toBe("disconnected");
    expect(env.session().attempt).toBeUndefined();
    await env.auth.connect();
    expect(new URL(env.launch.mock.calls[0]![0]).searchParams.get("client_id")).toBe(
      TWIR_CLIENT_ID,
    );
  });

  for (const error of [
    "access_denied",
    "invalid_scope",
    "invalid_target",
    "invalid_client",
    "unauthorized_client",
    "invalid_request",
    "unsupported_response_type",
    "server_error",
    "temporarily_unavailable",
  ]) {
    test(`shows the OAuth error ${error} and provider description without leaking callback secrets`, async () => {
      let callback = "";
      const env = setup({
        launch: async (url) => {
          callback = `${redirect}?error=${error}&error_description=Requested+permission+is+not+enabled&code=private-code&state=${new URL(url).searchParams.get("state")}`;
          return callback;
        },
      });
      const failure = await env.auth.connect().then(
        () => "unexpected success",
        (err: Error) => err.message,
      );
      expect(failure).toContain(`(${error})`);
      expect(failure).toContain("Requested permission is not enabled");
      expect(failure).not.toContain("private-code");
      expect(failure).not.toContain(redirect);
      expect(failure).not.toContain(new URL(callback).searchParams.get("state")!);
      expect(env.fetcher).not.toHaveBeenCalled();
    });
  }

  test("does not echo arbitrary OAuth error codes and redacts credentials in descriptions", async () => {
    const env = setup({
      launch: async (url) =>
        `${redirect}?error=access-token-secret&error_description=refresh_token%3Drefresh-secret&state=${new URL(url).searchParams.get("state")}`,
    });
    const failure = await env.auth.connect().catch((err: Error) => err.message);
    expect(failure).toBe("Twir OAuth: refresh_token=[hidden]");
  });

  test("token-endpoint configuration errors are actionable without exposing response fields", async () => {
    const env = setup({
      response: async () =>
        Response.json(
          {
            error: "invalid_client",
            error_description:
              "Token endpoint requires a public client. refresh_token=secret-token",
          },
          { status: 401 },
        ),
    });
    const failure = await env.auth.connect().catch((err: Error) => err.message);
    expect(failure).toContain("invalid_client");
    expect(failure).toContain("Token endpoint requires a public client.");
    expect(failure).toContain("HTTP 401");
    expect(failure).not.toContain("secret-token");
  });

  for (const error of [
    new Error("Authorization page could not be loaded."),
    { message: "The redirect URI does not match a registered redirect URI." },
    "User interaction required.",
  ]) {
    test("preserves native browser rejection messages instead of guessing cancellation", async () => {
      const env = setup({
        launch: async () => {
          throw error;
        },
      });
      const failure = await env.auth.connect().catch((err: Error) => err.message);
      const message = typeof error === "string" ? error : error.message;
      expect(failure).toBe(`Twir sign-in failed (browser): ${message}`);
      expect(failure).not.toContain("canceled");
    });
  }

  test("browser error messages cannot expose the authorization URL or PKCE parameters", async () => {
    let authorization = "";
    const env = setup({
      launch: async (url) => {
        authorization = url;
        throw new Error(
          `Authorization page could not be loaded: ${url}. state=${new URL(url).searchParams.get("state")}`,
        );
      },
    });
    const failure = await env.auth.connect().catch((err: Error) => err.message);
    expect(failure).toContain("Authorization page could not be loaded");
    expect(failure).not.toContain(new URL(authorization).searchParams.get("state")!);
    expect(failure).not.toContain(new URL(authorization).searchParams.get("code_challenge")!);
    expect(failure).not.toContain("https://");
    expect(failure).toContain("[hidden]");
  });

  test("missing browser details are described honestly, without stringifying an error object", async () => {
    const env = setup({
      launch: async () => {
        throw { access_token: "secret-token", stack: "private-stack" };
      },
    });
    await expect(env.auth.connect()).rejects.toThrow(
      "The browser did not provide an error description.",
    );
  });

  test("non-JSON token failures still show HTTP status without exposing raw response content", async () => {
    const env = setup({
      response: async () => new Response("<html>private-server-page</html>", { status: 502 }),
    });
    const failure = await env.auth.connect().catch((err: Error) => err.message);
    expect(failure).toContain("HTTP 502");
    expect(failure).not.toContain("private-server-page");
  });

  test("token network errors show their actual cause while redacting request credentials", async () => {
    const env = setup({
      record: { client, grant: { id: "grant", refreshToken: "short-secret" } },
      response: async () => {
        throw new TypeError("Failed to fetch; request body contained short-secret");
      },
    });
    const failure = await env.auth.accessToken().catch((err: Error) => err.message);
    expect(failure).toContain("Could not reach Twir (token request): TypeError: Failed to fetch");
    expect(failure).not.toContain("short-secret");
    expect(env.record().grant?.refreshToken).toBe("short-secret");
  });
});
