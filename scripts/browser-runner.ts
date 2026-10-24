import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createConnection, createServer, type Socket } from "node:net";
import type { BrowserTarget } from "./manifest";

type Packet = Record<string, unknown>;
type Reply = { resolve: (value: Packet) => void; reject: (error: Error) => void };

async function retry<T>(action: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await Bun.sleep(50);
    }
  }
  throw lastError;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Browser debugging request timed out")), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("Could not select a debugging port"));
      server.close(() => resolve(address.port));
    });
  });
}

async function connectTcp(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
    socket.once("connect", () => resolve(socket));
  });
}

// Firefox RDP uses byte-length-prefixed JSON and serial requests to named actors.
async function installFirefox(port: number, extension: string) {
  const socket = await retry(() => connectTcp(port));
  const greeting = Promise.withResolvers<Packet>();
  let greeted = false;
  let buffer: Buffer = Buffer.alloc(0);
  let pending: (Reply & { actor: string }) | undefined;
  const fail = (error: Error) => {
    greeting.reject(error);
    pending?.reject(error);
    pending = undefined;
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("Firefox debugging connection closed")));
  socket.on("data", (data) => {
    try {
      buffer = Buffer.concat([buffer, typeof data === "string" ? Buffer.from(data) : data]);
      while (true) {
        const colon = buffer.indexOf(58);
        if (colon === -1) return;
        const length = Number(buffer.subarray(0, colon).toString());
        if (!Number.isSafeInteger(length) || length < 0)
          throw new Error("Invalid Firefox debugging packet");
        if (buffer.length < colon + 1 + length) return;
        const packet = JSON.parse(
          buffer.subarray(colon + 1, colon + 1 + length).toString(),
        ) as Packet;
        buffer = buffer.subarray(colon + 1 + length);
        if (!greeted) {
          greeted = true;
          greeting.resolve(packet);
        } else if (pending && packet.from === pending.actor && !packet.type) {
          const reply = pending;
          pending = undefined;
          if (packet.error) reply.reject(new Error(`${packet.error}: ${packet.message}`));
          else reply.resolve(packet);
        }
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      socket.destroy();
    }
  });
  const request = (actor: string, type: string, params: Packet = {}) =>
    withTimeout(
      new Promise<Packet>((resolve, reject) => {
        pending = { actor, resolve, reject };
        const data = JSON.stringify({ to: actor, type, ...params });
        socket.write(`${Buffer.byteLength(data)}:${data}`);
      }),
    );
  try {
    await withTimeout(greeting.promise);
    const root = await request("root", "getRoot");
    if (typeof root.addonsActor !== "string")
      throw new Error("Firefox did not expose its add-ons actor");
    await request(root.addonsActor, "installTemporaryAddon", { addonPath: extension });
    return () => socket.destroy();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

// Chrome's CDP is JSON-RPC over a loopback WebSocket, scoped to our temporary profile.
async function installChrome(profile: string, extension: string, url: string) {
  const info = await retry(() => Bun.file(join(profile, "DevToolsActivePort")).text());
  const [port, path] = info.trim().split("\n");
  if (!/^\d+$/.test(port ?? "") || !path?.startsWith("/devtools/browser/"))
    throw new Error("Invalid Chrome debugging endpoint");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  const connected = Promise.withResolvers<void>();
  const pending = new Map<number, Reply>();
  let id = 0;
  const fail = () => {
    const error = new Error("Chrome debugging connection closed");
    connected.reject(error);
    for (const reply of pending.values()) reply.reject(error);
    pending.clear();
  };
  socket.addEventListener("open", () => connected.resolve());
  socket.addEventListener("error", fail);
  socket.addEventListener("close", fail);
  socket.addEventListener("message", (event) => {
    const packet = JSON.parse(String(event.data));
    const reply = pending.get(packet.id);
    if (!reply) return;
    pending.delete(packet.id);
    if (packet.error) reply.reject(new Error(packet.error.message));
    else reply.resolve(packet.result);
  });
  const request = (method: string, params: Packet) =>
    withTimeout(
      new Promise<Packet>((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    );
  try {
    await withTimeout(connected.promise);
    await request("Extensions.loadUnpacked", { path: extension });
    await request("Target.createTarget", { url });
    return () => socket.close();
  } catch (error) {
    socket.close();
    throw error;
  }
}

export async function startBrowser(
  target: BrowserTarget,
  extension: string,
  directory: string,
  url: string,
) {
  const profile = join(directory, "profile");
  await mkdir(profile);
  const port = target === "firefox" ? await freePort() : 0;
  if (target === "firefox") {
    const prefs = {
      "devtools.debugger.remote-enabled": true,
      "devtools.debugger.prompt-connection": false,
      "devtools.debugger.force-local": true,
      "devtools.chrome.enabled": true,
      "browser.shell.checkDefaultBrowser": false,
      "browser.aboutwelcome.enabled": false,
    };
    await Bun.write(
      join(profile, "user.js"),
      Object.entries(prefs)
        .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
        .join("\n"),
    );
  }
  const command =
    target === "firefox"
      ? [
          Bun.env.FIREFOX_BINARY ?? "firefox",
          "--headless",
          "--no-remote",
          "--profile",
          profile,
          "--start-debugger-server",
          String(port),
          url,
        ]
      : [
          Bun.env.CHROME_BINARY ??
            Bun.which("chromium") ??
            Bun.which("google-chrome") ??
            "chromium",
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          "--enable-unsafe-extension-debugging",
          `--user-data-dir=${profile}`,
          "about:blank",
        ];
  const process = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const stderr = new Response(process.stderr).text();
  let disconnect: (() => void) | undefined;
  const exit = async () => {
    disconnect?.();
    if (process.exitCode !== null) return;
    process.kill();
    const force = setTimeout(() => process.kill("SIGKILL"), 3_000);
    try {
      await process.exited;
    } finally {
      clearTimeout(force);
    }
  };
  try {
    disconnect =
      target === "firefox"
        ? await installFirefox(port, extension)
        : await installChrome(profile, extension, url);
    return { exit };
  } catch (error) {
    await exit();
    throw new Error(
      `${error instanceof Error ? error.message : error}\n${(await stderr).slice(-4_000)}`,
    );
  }
}
