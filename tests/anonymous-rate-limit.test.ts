import { afterEach, describe, expect, it } from "vitest";
import {
  anonymousRateLimitHeaders,
  checkAnonymousUploadRateLimit,
  resetAnonymousUploadRateLimit
} from "../src/lib/anonymous-rate-limit";

describe("anonymous upload rate limit", () => {
  afterEach(() => {
    delete process.env.MD_SHARE_ANONYMOUS_UPLOAD_LIMIT;
    delete process.env.MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT;
    delete process.env.MD_SHARE_ANONYMOUS_UPLOAD_WINDOW_SECONDS;
    resetAnonymousUploadRateLimit();
  });

  it("enforces per-client and global fixed-window limits without retaining a raw address", () => {
    process.env.MD_SHARE_ANONYMOUS_UPLOAD_LIMIT = "2";
    process.env.MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT = "3";
    process.env.MD_SHARE_ANONYMOUS_UPLOAD_WINDOW_SECONDS = "60";
    const firstClient = new Request("https://share.example.test/api/documents", {
      headers: { "x-real-ip": "192.0.2.10" }
    });
    const secondClient = new Request("https://share.example.test/api/documents", {
      headers: { "x-real-ip": "192.0.2.11" }
    });
    const now = Date.UTC(2026, 6, 17, 0, 0, 0);

    expect(checkAnonymousUploadRateLimit(firstClient, now)).toMatchObject({
      allowed: true,
      remaining: 1
    });
    expect(checkAnonymousUploadRateLimit(firstClient, now)).toMatchObject({
      allowed: true,
      remaining: 0
    });
    const clientLimited = checkAnonymousUploadRateLimit(firstClient, now);
    expect(clientLimited).toMatchObject({ allowed: false, retryAfter: 60 });
    expect(anonymousRateLimitHeaders(clientLimited)).toMatchObject({
      "Retry-After": "60",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Scope": "client"
    });

    expect(checkAnonymousUploadRateLimit(secondClient, now).allowed).toBe(true);
    const globallyLimited = checkAnonymousUploadRateLimit(secondClient, now);
    expect(globallyLimited).toMatchObject({ allowed: false, scope: "global", limit: 3 });
    expect(anonymousRateLimitHeaders(globallyLimited)["X-RateLimit-Scope"]).toBe("global");
    expect(checkAnonymousUploadRateLimit(firstClient, now + 60_000).allowed).toBe(true);
  });
});
