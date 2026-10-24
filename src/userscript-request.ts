export interface UserscriptResponse {
  status: number;
  responseText: string;
  finalUrl: string;
}

export interface UserscriptRequestDetails {
  method: "POST";
  url: string;
  data: FormData;
  anonymous: true;
  redirect: "error";
  headers: Record<string, string>;
  onload: (response: UserscriptResponse) => void;
  onerror: () => void;
  onabort: () => void;
  ontimeout: () => void;
}

export type UserscriptRequest = (details: UserscriptRequestDetails) => { abort(): void };

// A narrow fetch adapter for uploadImage, not a general-purpose fetch replacement.
export function createUserscriptFetch(request: UserscriptRequest) {
  return (url: string, init: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      const signal = init.signal;
      let handle: ReturnType<UserscriptRequest> | undefined;
      const finish = (error?: unknown, response?: Response) => {
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(response!);
      };
      const abort = () => {
        finish(signal?.reason ?? new DOMException("Upload canceled.", "AbortError"));
        handle?.abort();
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      try {
        handle = request({
          method: "POST",
          url,
          data: init.body as FormData,
          anonymous: true,
          redirect: "error",
          headers: { Referer: "" },
          onload(response) {
            try {
              if (response.finalUrl !== url) throw new Error("Twir redirected the upload.");
              finish(undefined, new Response(response.responseText, { status: response.status }));
            } catch (error) {
              finish(error);
            }
          },
          onerror: () => finish(new Error("Tampermonkey could not connect to Twir.")),
          onabort: () => finish(new DOMException("Upload canceled.", "AbortError")),
          ontimeout: () => finish(new DOMException("Upload timed out.", "TimeoutError")),
        });
      } catch (error) {
        finish(error);
      }
      // anonymous/redirect enforce fetch mode in Tampermonkey, where its native
      // timeout option may be ignored. The AbortSignal above enforces our deadline.
    });
}
