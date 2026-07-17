import crypto from "node:crypto";

export const ADMIN_SESSION_COOKIE = "md_share_admin_session";
export const ADMIN_CSRF_HEADER = "x-md-share-csrf";

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_LOGIN_LIMIT = 5;
const DEFAULT_GLOBAL_LOGIN_LIMIT = 50;
const DEFAULT_LOGIN_WINDOW_SECONDS = 5 * 60;
const MIN_ADMIN_PASSWORD_LENGTH = 8;
const MAX_SESSIONS = 1_000;
const MAX_LOGIN_BUCKETS = 10_000;

interface SessionRecord {
  username: string;
  expiresAt: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

interface AdminAuthState {
  sessions: Map<string, SessionRecord>;
  loginBuckets: Map<string, RateBucket>;
  globalLoginBucket?: RateBucket;
}

export interface AdminSession {
  username: string;
  expiresAt: string;
  csrfToken: string;
}

export interface AdminLoginRateDecision {
  allowed: boolean;
  scope: "client" | "global";
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export type AdminCredentialResult =
  | { ok: true; username: string; rateLimit: AdminLoginRateDecision }
  | {
      ok: false;
      status: 401 | 429 | 503;
      code: "ADMIN_AUTH_FAILED" | "ADMIN_AUTH_NOT_CONFIGURED" | "ADMIN_LOGIN_RATE_LIMITED";
      message: string;
      rateLimit?: AdminLoginRateDecision;
    };

const globalForAdminAuth = globalThis as typeof globalThis & {
  __mdShareAdminAuth?: AdminAuthState;
};

const state =
  globalForAdminAuth.__mdShareAdminAuth ??
  (globalForAdminAuth.__mdShareAdminAuth = {
    sessions: new Map<string, SessionRecord>(),
    loginBuckets: new Map<string, RateBucket>()
  });

function safeEqual(a: string, b: string): boolean {
  const first = crypto.createHash("sha256").update(a).digest();
  const second = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(first, second);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function configuredInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function adminCredentials(): { username: string; password: string } | undefined {
  const username = process.env.MD_SHARE_ADMIN_USERNAME ?? "";
  const password = process.env.MD_SHARE_ADMIN_PASSWORD ?? "";
  if (
    !username ||
    username.length > 128 ||
    password.length < MIN_ADMIN_PASSWORD_LENGTH ||
    password.length > 1_024
  ) {
    return undefined;
  }
  return { username, password };
}

function requestCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function clientKey(request: Request): string {
  const identity =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown-client";
  return sha256(identity);
}

function currentBucket(bucket: RateBucket | undefined, now: number, windowMs: number): RateBucket {
  if (!bucket || bucket.resetAt <= now) return { count: 0, resetAt: now + windowMs };
  return bucket;
}

function pruneLoginBuckets(now: number): void {
  for (const [key, bucket] of state.loginBuckets) {
    if (bucket.resetAt <= now) state.loginBuckets.delete(key);
  }
  while (state.loginBuckets.size >= MAX_LOGIN_BUCKETS) {
    const oldest = state.loginBuckets.keys().next().value as string | undefined;
    if (!oldest) break;
    state.loginBuckets.delete(oldest);
  }
}

function checkAdminLoginRateLimit(request: Request, now: number): AdminLoginRateDecision {
  const clientLimit = configuredInteger("MD_SHARE_ADMIN_LOGIN_LIMIT", DEFAULT_LOGIN_LIMIT, 1_000);
  const globalLimit = configuredInteger(
    "MD_SHARE_ADMIN_LOGIN_GLOBAL_LIMIT",
    DEFAULT_GLOBAL_LOGIN_LIMIT,
    100_000
  );
  const windowSeconds = configuredInteger(
    "MD_SHARE_ADMIN_LOGIN_WINDOW_SECONDS",
    DEFAULT_LOGIN_WINDOW_SECONDS,
    86_400
  );
  const windowMs = windowSeconds * 1_000;
  const key = clientKey(request);
  const client = currentBucket(state.loginBuckets.get(key), now, windowMs);
  const global = currentBucket(state.globalLoginBucket, now, windowMs);
  const clientBlocked = client.count >= clientLimit;
  const globalBlocked = global.count >= globalLimit;

  if (clientBlocked || globalBlocked) {
    const scope = clientBlocked ? "client" : "global";
    const resetAt = Math.max(
      clientBlocked ? client.resetAt : now,
      globalBlocked ? global.resetAt : now
    );
    return {
      allowed: false,
      scope,
      limit: scope === "client" ? clientLimit : globalLimit,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1_000))
    };
  }

  if (!state.loginBuckets.has(key) && state.loginBuckets.size >= MAX_LOGIN_BUCKETS) {
    pruneLoginBuckets(now);
  }
  const nextClient = { ...client, count: client.count + 1 };
  state.loginBuckets.set(key, nextClient);
  state.globalLoginBucket = { ...global, count: global.count + 1 };
  return {
    allowed: true,
    scope: "client",
    limit: clientLimit,
    remaining: clientLimit - nextClient.count,
    resetAt: nextClient.resetAt,
    retryAfter: 0
  };
}

function pruneSessions(now: number): void {
  for (const [key, session] of state.sessions) {
    if (session.expiresAt <= now) state.sessions.delete(key);
  }
  while (state.sessions.size >= MAX_SESSIONS) {
    const oldest = state.sessions.keys().next().value as string | undefined;
    if (!oldest) break;
    state.sessions.delete(oldest);
  }
}

function csrfToken(sessionToken: string): string {
  return sha256(`md-share-admin-csrf:${sessionToken}`);
}

export function isAdminAuthConfigured(): boolean {
  return adminCredentials() !== undefined;
}

export function authenticateAdminCredentials(
  request: Request,
  username: string,
  password: string,
  now = Date.now()
): AdminCredentialResult {
  const credentials = adminCredentials();
  if (!credentials) {
    return {
      ok: false,
      status: 503,
      code: "ADMIN_AUTH_NOT_CONFIGURED",
      message: "administrator credentials are not configured"
    };
  }
  const rateLimit = checkAdminLoginRateLimit(request, now);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      status: 429,
      code: "ADMIN_LOGIN_RATE_LIMITED",
      message: "administrator login rate limit exceeded",
      rateLimit
    };
  }
  const usernameMatches = safeEqual(username, credentials.username);
  const passwordMatches = safeEqual(password, credentials.password);
  if (!usernameMatches || !passwordMatches) {
    return {
      ok: false,
      status: 401,
      code: "ADMIN_AUTH_FAILED",
      message: "invalid administrator credentials",
      rateLimit
    };
  }
  return { ok: true, username: credentials.username, rateLimit };
}

export function adminLoginRateLimitHeaders(
  decision: AdminLoginRateDecision
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1_000)),
    "X-RateLimit-Scope": decision.scope,
    ...(decision.allowed ? {} : { "Retry-After": String(decision.retryAfter) })
  };
}

export function createAdminSession(username: string, now = Date.now()): {
  token: string;
  session: AdminSession;
  maxAge: number;
} {
  pruneSessions(now);
  const maxAge = configuredInteger(
    "MD_SHARE_ADMIN_SESSION_TTL_SECONDS",
    DEFAULT_SESSION_TTL_SECONDS,
    7 * 24 * 60 * 60
  );
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + maxAge * 1_000;
  state.sessions.set(sha256(token), { username, expiresAt });
  return {
    token,
    maxAge,
    session: {
      username,
      expiresAt: new Date(expiresAt).toISOString(),
      csrfToken: csrfToken(token)
    }
  };
}

export function readAdminSession(request: Request, now = Date.now()): AdminSession | undefined {
  const token = requestCookie(request, ADMIN_SESSION_COOKIE);
  if (!token) return undefined;
  const key = sha256(token);
  const record = state.sessions.get(key);
  if (!record) return undefined;
  if (record.expiresAt <= now) {
    state.sessions.delete(key);
    return undefined;
  }
  return {
    username: record.username,
    expiresAt: new Date(record.expiresAt).toISOString(),
    csrfToken: csrfToken(token)
  };
}

export function revokeAdminSession(request: Request): void {
  const token = requestCookie(request, ADMIN_SESSION_COOKIE);
  if (token) state.sessions.delete(sha256(token));
}

export function hasValidAdminCsrf(request: Request): boolean {
  const session = readAdminSession(request);
  const provided = request.headers.get(ADMIN_CSRF_HEADER) ?? "";
  return Boolean(session && provided && safeEqual(provided, session.csrfToken));
}

export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(request.url).protocol === "https:";
}

export function resetAdminAuthState(): void {
  state.sessions.clear();
  state.loginBuckets.clear();
  state.globalLoginBucket = undefined;
}
