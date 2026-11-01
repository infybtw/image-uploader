const SECRET_FIELD =
  /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|code[_-]?verifier|code[_-]?challenge|authorization[_-]?code|authorization|password|state|code|token)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&<>]+)/gi;

// Read only human-readable messages, never stringify a whole response/error
// object: it may contain request bodies, tokens, callback URLs or stack traces.
export function authErrorDetail(error: unknown, secrets: readonly string[] = []): string {
  let message = "";
  try {
    if (typeof error === "string") message = error;
    else if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      message = error.message;
      if (
        "name" in error &&
        typeof error.name === "string" &&
        /^(?:Type|Timeout|Abort|Network|Security)Error$/.test(error.name)
      ) {
        message = `${error.name}: ${message}`;
      }
    }
  } catch {
    return "";
  }
  if (!message || message.length > 16_384) return "";

  // Decode escaped diagnostics before redaction, including nested URL encoding.
  for (let pass = 0; pass < 3; pass++) {
    message = message.replace(/(?:%[0-9a-f]{2})+/gi, (part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  }
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.replaceAll(secret, "[hidden]");
  }
  message = message
    .replace(/(?:https?|moz-extension|chrome-extension):\/\/[^\s<>"']+/gi, "[URL hidden]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [hidden]")
    .replace(SECRET_FIELD, (field) => `${field.slice(0, field.search(/[:=]/) + 1)}[hidden]`)
    // Opaque token/JWT-like values not explicitly labelled in a diagnostic.
    .replace(/[A-Za-z0-9._~+\/-]{32,}=*/g, "[hidden]")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return message.length > 1_000 ? `${message.slice(0, 1_000)}…` : message;
}

export function oauthSecretValues(value: Record<string, unknown>): string[] {
  return [
    "access_token",
    "refresh_token",
    "id_token",
    "token",
    "client_secret",
    "code",
    "code_verifier",
    "code_challenge",
    "state",
  ].flatMap((key) => (typeof value[key] === "string" ? [value[key]] : []));
}
