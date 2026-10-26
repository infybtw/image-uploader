export interface PreviewFilters {
  blockedUsers: string[];
  blockedDomains: string[];
  hideBots: boolean;
}

// These are known service accounts, not a heuristic based on a nickname suffix.
export const KNOWN_CHAT_BOTS = new Set([
  "nightbot",
  "streamelements",
  "streamlabs",
  "moobot",
  "fossabot",
  "wizebot",
  "botrix",
  "botisimo",
  "sery_bot",
  "soundalerts",
  "pretzelrocks",
  "commanderroot",
]);

function entries(value: unknown): string[] {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return values.flatMap((item) => (typeof item === "string" ? item.split(/[\s,;]+/) : []));
}

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function normalizeUserList(value: unknown): string[] {
  return [...new Set(entries(value).map(normalizeUsername))].filter((name) =>
    /^[\p{L}\p{N}_-]{1,64}$/u.test(name),
  );
}

export function normalizeDomain(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/^\*\./, "");
  if (!text) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.replace(/\.$/, "");
    if (!hostname || !/^[a-z0-9.-]+$/.test(hostname)) return null;
    if (hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
      return null;
    return hostname;
  } catch {
    return null;
  }
}

export function normalizeDomainList(value: unknown): string[] {
  return [
    ...new Set(
      entries(value)
        .map(normalizeDomain)
        .filter((host) => host !== null),
    ),
  ];
}

export function createPreviewFilter(filters: PreviewFilters) {
  const users = new Set(normalizeUserList(filters.blockedUsers));
  const domains = new Set(normalizeDomainList(filters.blockedDomains));
  return {
    filtersAuthors: users.size > 0 || filters.hideBots,
    blocksAuthor(username: string, botBadge = false): boolean {
      const name = normalizeUsername(username);
      return users.has(name) || (filters.hideBots && (botBadge || KNOWN_CHAT_BOTS.has(name)));
    },
    blocksUrl(value: string): boolean {
      if (!domains.size) return false;
      let hostname: string;
      try {
        hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
      } catch {
        return false;
      }
      // Exact DNS labels only: example.com does not block notexample.com.
      for (;;) {
        if (domains.has(hostname)) return true;
        const dot = hostname.indexOf(".");
        if (dot < 0) return false;
        hostname = hostname.slice(dot + 1);
      }
    },
  };
}
