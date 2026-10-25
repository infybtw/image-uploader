import { getChatPreviewUrl } from "./shared";

export const PREVIEW_PAGE_TIMEOUT_MS = 8000;
export const MAX_PREVIEW_PAGE_SIZE = 512 * 1024;
export interface PreviewPage {
  html: string;
  url: string;
}
export type LoadPreviewPage = (url: string) => Promise<PreviewPage | null>;
export type ResolvePreviewPage = (url: string) => Promise<string | null>;
export interface PreviewPageReply {
  page: PreviewPage | null;
}

// Metadata can be supplied by any HTTP(S) page; keep query parameters and reject credentials.
export function getPreviewPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !getChatPreviewUrl(value)) return null;
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export async function loadPreviewPage(
  value: unknown,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<PreviewPage | null> {
  const url = getPreviewPageUrl(value);
  if (!url) return null;
  try {
    const response = await fetcher(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "follow",
      signal: AbortSignal.timeout(PREVIEW_PAGE_TIMEOUT_MS),
    });
    const finalUrl = getPreviewPageUrl(response.url || url);
    if (
      !finalUrl ||
      !response.ok ||
      !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")
    ) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let size = 0;
    let html = "";
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) return { html: html + decoder.decode(), url: finalUrl };
        size += chunk.byteLength;
        if (size > MAX_PREVIEW_PAGE_SIZE) return null;
        html += decoder.decode(chunk, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}

export function extractPreviewImage(
  html: string,
  pageUrl: string,
  owner = document,
): string | null {
  if (html.length > MAX_PREVIEW_PAGE_SIZE) return null;
  // Template contents stay inert: no scripts, frames or image requests from fetched HTML.
  const template = owner.createElement("template");
  template.innerHTML = html;
  let baseUrl = pageUrl;
  const base = template.content.querySelector("base[href]")?.getAttribute("href");
  if (base) {
    try {
      baseUrl = getChatPreviewUrl(new URL(base, pageUrl).href) ?? pageUrl;
    } catch {
      // Ignore invalid base URLs.
    }
  }
  const metadata = [...template.content.querySelectorAll("meta")];
  for (const name of [
    "og:image:secure_url",
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ]) {
    for (const meta of metadata) {
      if ((meta.getAttribute("property") ?? meta.getAttribute("name"))?.toLowerCase() !== name)
        continue;
      const content = meta.getAttribute("content")?.trim();
      if (!content) continue;
      try {
        const url = getChatPreviewUrl(new URL(content, baseUrl).href);
        if (url) return url;
      } catch {
        // Try the next metadata candidate.
      }
    }
  }
  return null;
}

export function createPreviewPageResolver(load: LoadPreviewPage): ResolvePreviewPage {
  const cache = new Map<string, Promise<string | null>>();
  return (value) => {
    const url = getPreviewPageUrl(value);
    if (!url) return Promise.resolve(null);
    const previous = cache.get(url);
    if (previous) return previous;
    const pending = Promise.resolve()
      .then(() => load(url))
      .then((page) => (page === null ? null : extractPreviewImage(page.html, page.url)))
      .catch(() => null);
    cache.set(url, pending);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return pending;
  };
}
