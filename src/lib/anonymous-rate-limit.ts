import crypto from "node:crypto";

const DEFAULT_CLIENT_LIMIT = 20;
const DEFAULT_GLOBAL_LIMIT = 200;
const DEFAULT_WINDOW_SECONDS = 60;
const MAX_CLIENT_BUCKETS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

export interface AnonymousRateLimitDecision {
  allowed: boolean;
  scope: "client" | "global";
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

const clientBuckets = new Map<string, Bucket>();
let globalBucket: Bucket | undefined;

function configuredInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function clientKey(request: Request): string {
  const identity =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown-client";
  return crypto.createHash("sha256").update(identity).digest("base64url");
}

function currentBucket(bucket: Bucket | undefined, now: number, windowMs: number): Bucket {
  if (!bucket || bucket.resetAt <= now) return { count: 0, resetAt: now + windowMs };
  return bucket;
}

function pruneClientBuckets(now: number) {
  for (const [key, bucket] of clientBuckets) {
    if (bucket.resetAt <= now) clientBuckets.delete(key);
  }
  while (clientBuckets.size >= MAX_CLIENT_BUCKETS) {
    const oldest = clientBuckets.keys().next().value as string | undefined;
    if (!oldest) break;
    clientBuckets.delete(oldest);
  }
}

export function checkAnonymousUploadRateLimit(
  request: Request,
  now = Date.now()
): AnonymousRateLimitDecision {
  const clientLimit = configuredInteger(
    "MD_SHARE_ANONYMOUS_UPLOAD_LIMIT",
    DEFAULT_CLIENT_LIMIT,
    100_000
  );
  const globalLimit = configuredInteger(
    "MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT",
    DEFAULT_GLOBAL_LIMIT,
    1_000_000
  );
  const windowSeconds = configuredInteger(
    "MD_SHARE_ANONYMOUS_UPLOAD_WINDOW_SECONDS",
    DEFAULT_WINDOW_SECONDS,
    86_400
  );
  const windowMs = windowSeconds * 1_000;
  const key = clientKey(request);
  const client = currentBucket(clientBuckets.get(key), now, windowMs);
  const global = currentBucket(globalBucket, now, windowMs);
  const clientBlocked = client.count >= clientLimit;
  const globalBlocked = global.count >= globalLimit;

  if (clientBlocked || globalBlocked) {
    const scope = clientBlocked ? "client" : "global";
    const blockedUntil = Math.max(
      clientBlocked ? client.resetAt : now,
      globalBlocked ? global.resetAt : now
    );
    return {
      allowed: false,
      scope,
      limit: scope === "client" ? clientLimit : globalLimit,
      remaining: 0,
      resetAt: blockedUntil,
      retryAfter: Math.max(1, Math.ceil((blockedUntil - now) / 1_000))
    };
  }

  if (!clientBuckets.has(key) && clientBuckets.size >= MAX_CLIENT_BUCKETS) {
    pruneClientBuckets(now);
  }
  const nextClient = { ...client, count: client.count + 1 };
  clientBuckets.set(key, nextClient);
  globalBucket = { ...global, count: global.count + 1 };
  return {
    allowed: true,
    scope: "client",
    limit: clientLimit,
    remaining: clientLimit - nextClient.count,
    resetAt: nextClient.resetAt,
    retryAfter: 0
  };
}

export function anonymousRateLimitHeaders(
  decision: AnonymousRateLimitDecision
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1_000)),
    "X-RateLimit-Scope": decision.scope,
    ...(decision.allowed ? {} : { "Retry-After": String(decision.retryAfter) })
  };
}

export function resetAnonymousUploadRateLimit(): void {
  clientBuckets.clear();
  globalBucket = undefined;
}
