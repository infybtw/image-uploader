import type { AuthRecord, AuthSession, AuthStore } from "./twir-auth";

export const AUTH_SESSION_KEY = "twirOAuthSession";
const DATABASE = "viewer-companion-accounts";
const STORE = "credentials";

// Called only in the extension background origin, never a content script.
// IndexedDB here is isolated from both websites and their content-script origins.
export function createAuthStore(session: {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<unknown>;
}): AuthStore {
  async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Could not open account storage. Check your browser's storage settings."));
      request.onblocked = () =>
        reject(new Error("Account storage is busy. Restart the extension and try again."));
    });
  }

  async function transaction(write: boolean, record?: AuthRecord): Promise<AuthRecord> {
    const db = await database();
    try {
      return await new Promise<AuthRecord>((resolve, reject) => {
        const tx = db.transaction(STORE, write ? "readwrite" : "readonly");
        const request = write
          ? tx.objectStore(STORE).put(record, "twir")
          : tx.objectStore(STORE).get("twir");
        tx.oncomplete = () => resolve(write ? record! : (request.result ?? {}));
        tx.onabort = () =>
          reject(new Error("Could not save account data. Check your browser's storage settings."));
        tx.onerror = () => reject(new Error("Could not access account storage. Try again."));
      });
    } finally {
      db.close();
    }
  }

  return {
    read: () => transaction(false),
    async write(record) {
      await transaction(true, record);
    },
    async readSession() {
      const values = await session.get(AUTH_SESSION_KEY);
      return (values[AUTH_SESSION_KEY] ?? {}) as AuthSession;
    },
    async writeSession(value) {
      await session.set({ [AUTH_SESSION_KEY]: value });
    },
  };
}
