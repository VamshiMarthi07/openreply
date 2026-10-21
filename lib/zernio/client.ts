
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
} from "@/lib/meta/client";

export class ZernioApiError extends MetaApiError {
  constructor(status: number, detail?: string) {
    const safeDetail = detail
      ?.replace(/Bearer\s+\S+/gi, "[REDACTED]")
      .slice(0, 200);

    super(
      status,
      undefined,
      undefined,
      `Zernio request failed (HTTP ${status})${
        safeDetail ? `: ${safeDetail}` : ""
      }`
    );
    this.name = "ZernioApiError";
  }
}

export class ZernioDeliveryUnconfirmedError extends ZernioApiError {
  constructor() {
    super(502);
    this.name = "ZernioDeliveryUnconfirmedError";
    this.message =
      "Message delivery is unconfirmed. Inspect the Instagram inbox before retrying.";
  }
}

export async function zernioRequest<T>({
  apiKey,
  path,
  method = "GET",
  body,
  idempotencyKey,
}: {
  apiKey: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Invalid Zernio API path");
  }

  const response = await fetch(`https://zernio.com/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw new ZernioApiError(502);
  });

  if (!response.ok) {
    // Extract only a short error field, never log the full response body.
    const rawError = await response.clone().text().catch(() => "");
    let safeDetail = "";

    try {
      const parsed = JSON.parse(rawError);
      const detail =
        parsed?.message ??
        parsed?.error ??
        parsed?.code ??
        parsed?.details?.message;

      if (typeof detail === "string") {
        safeDetail = detail
          .replace(/Bearer\s+\S+/gi, "[REDACTED]")
          .slice(0, 200);
      }
    } catch {
      // Ignore unstructured response bodies.
    }

    const message =
      `Zernio request failed (HTTP ${response.status})`;

    if (response.status === 429) {
      throw new RateLimitError(
        safeDetail ? `${message}: ${safeDetail}` : message
      );
    }

    if (response.status === 401) {
      throw new TokenExpiredError(
        safeDetail ? `${message}: ${safeDetail}` : message
      );
    }

    throw new ZernioApiError(response.status, safeDetail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json().catch(() => {
    throw new ZernioApiError(502);
  }) as Promise<T>;
}
