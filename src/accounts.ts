// Public account state only. Credentials never cross the background boundary.
export type TwirAccountStatus = "disconnected" | "connecting" | "connected" | "reconnect-required";

export interface Accounts {
  status(): Promise<TwirAccountStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<{ revoked: boolean }>;
}

export type AccountAction = "twir-status" | "twir-connect" | "twir-disconnect";
export type AccountReply =
  { ok: true; status: TwirAccountStatus; revoked?: boolean } | { ok: false; error: string };

export function isAccountAction(value: unknown): value is AccountAction {
  return value === "twir-status" || value === "twir-connect" || value === "twir-disconnect";
}
