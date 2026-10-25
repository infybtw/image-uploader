import {
  getPreviewPageUrl,
  MAX_PREVIEW_PAGE_SIZE,
  PREVIEW_PAGE_TIMEOUT_MS,
  type LoadPreviewPage,
  type PreviewPage,
} from "./preview-page";
import type { UserscriptRequestDetails } from "./userscript-request";

export type UserscriptPreviewRequestDetails = Omit<
  UserscriptRequestDetails,
  "method" | "data" | "redirect"
> & {
  method: "GET";
  redirect: "follow";
};
export type UserscriptPreviewRequest = (details: UserscriptPreviewRequestDetails) => {
  abort(): void;
};

export function createUserscriptPreviewLoader(
  request: UserscriptPreviewRequest,
  timeoutMs = PREVIEW_PAGE_TIMEOUT_MS,
): LoadPreviewPage {
  return (value) => {
    const url = getPreviewPageUrl(value);
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      let handle: ReturnType<UserscriptPreviewRequest> | undefined;
      const finish = (page: PreviewPage | null) => {
        clearTimeout(timer);
        resolve(page);
      };
      // anonymous/redirect use fetch mode, which may ignore Tampermonkey's native timeout.
      const timer = setTimeout(() => {
        finish(null);
        handle?.abort();
      }, timeoutMs);
      try {
        handle = request({
          method: "GET",
          url,
          anonymous: true,
          redirect: "follow",
          headers: { Referer: "", Accept: "text/html" },
          onload(response) {
            const finalUrl = getPreviewPageUrl(response.finalUrl);
            finish(
              response.status === 200 &&
                finalUrl &&
                new TextEncoder().encode(response.responseText).byteLength <= MAX_PREVIEW_PAGE_SIZE
                ? { html: response.responseText, url: finalUrl }
                : null,
            );
          },
          onerror: () => finish(null),
          onabort: () => finish(null),
          ontimeout: () => finish(null),
        });
      } catch {
        finish(null);
      }
    });
  };
}
