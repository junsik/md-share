"use client";

import { useEffect, useState } from "react";
import MarkdownView from "./MarkdownView";

interface InstallTarget {
  label: string;
  note: string;
  command: (origin: string) => string;
}

const INSTALL_TARGETS: InstallTarget[] = [
  {
    label: "Claude Code",
    note: "Run in the project root. Use ~/.claude/skills instead to install for every project.",
    command: (origin) =>
      `mkdir -p .claude/skills/md-share && curl -fsSL ${origin}/skill.md -o .claude/skills/md-share/SKILL.md`
  },
  {
    label: "Codex / OpenCode",
    note: "Agents that read skills from the shared .agents directory.",
    command: (origin) =>
      `mkdir -p .agents/skills/md-share && curl -fsSL ${origin}/skill.md -o .agents/skills/md-share/SKILL.md`
  }
];

function CopyButton({ getText, label }: { getText: () => Promise<string>; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(await getText());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

async function fetchMarkdown(pathname: string): Promise<string> {
  const response = await fetch(pathname);
  if (!response.ok) throw new Error(`${pathname} fetch failed`);
  return response.text();
}

function AiDialog({ onClose }: { onClose: () => void }) {
  const [origin, setOrigin] = useState("");
  const [view, setView] = useState<"install" | "api">("install");
  const [apiDoc, setApiDoc] = useState<string | null>(null);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function openApi() {
    setView("api");
    if (apiDoc != null) return;
    try {
      setApiDoc(await fetchMarkdown("/api.md"));
    } catch {
      setApiError(true);
    }
  }

  if (view === "api") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        onClick={onClose}
      >
        <div
          className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-6 py-3">
            <h2 className="text-lg font-semibold text-foreground">API reference</h2>
            <div className="flex items-center gap-2">
              {apiDoc != null ? (
                <CopyButton label="Copy markdown" getText={() => Promise.resolve(apiDoc)} />
              ) : null}
              <button
                type="button"
                onClick={() => setView("install")}
                className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {apiError ? (
              <p className="text-sm text-red-400">Failed to load the API reference.</p>
            ) : apiDoc == null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <MarkdownView markdown={apiDoc} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">Use with AI agents</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Install the md-share skill and your agent will share markdown as rendered
          links from this instance instead of attaching .md files. The skill is
          served at{" "}
          <a href="/skill.md" className="text-primary underline">
            /skill.md
          </a>{" "}
          with this instance&apos;s URL already filled in.
        </p>

        <div className="mt-4 space-y-4 text-sm">
          {INSTALL_TARGETS.map((target) => (
            <div key={target.label}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{target.label}</span>
                <CopyButton
                  label="Copy command"
                  getText={() => Promise.resolve(target.command(origin))}
                />
              </div>
              <pre className="overflow-x-auto rounded border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
                {target.command(origin)}
              </pre>
              <p className="mt-1 text-xs text-muted-foreground">{target.note}</p>
            </div>
          ))}

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">Any other agent</span>
              <CopyButton
                label="Copy skill markdown"
                getText={() => fetchMarkdown("/skill.md")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Copies the full skill text — paste it into the agent&apos;s instructions
              (CLAUDE.md, AGENTS.md, or a system prompt).
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
          <button
            type="button"
            onClick={openApi}
            className="rounded border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
          >
            API reference
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AiButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Use with AI agents"
        className="rounded border border-border bg-muted px-4 py-1.5 text-sm text-foreground hover:border-muted-foreground"
      >
        AI
      </button>
      {open ? <AiDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
