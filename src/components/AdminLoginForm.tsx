"use client";

import { SyntheticEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function loginError(value: unknown, status: number, retryAfter: string | null): string {
  if (status === 429) {
    return `Too many login attempts. Try again in ${retryAfter ?? "a few"} seconds.`;
  }
  if (status === 503) return "Administrator login is not configured on this instance.";
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    value.error &&
    typeof value.error === "object" &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return "Administrator login failed.";
}

export default function AdminLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) {
        setError(loginError(body, response.status, response.headers.get("retry-after")));
        return;
      }
      setPassword("");
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Administrator login is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← md-share
        </Link>
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Operations
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Administrator sign in</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use the administrator ID and password configured by this instance&apos;s installer.
            Credentials are exchanged for a temporary browser session.
          </p>
        </div>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Administrator ID
            </span>
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={128}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={pending}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-primary disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-muted-foreground">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1_024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-primary disabled:opacity-50"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-xs leading-5 text-muted-foreground">
          The password is not stored in browser storage. Signing in creates an HttpOnly session
          that expires automatically.
        </p>
      </section>
    </main>
  );
}
