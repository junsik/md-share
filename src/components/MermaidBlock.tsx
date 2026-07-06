"use client";

import { useEffect, useId, useState } from "react";

export default function MermaidBlock({ code }: { code: string }) {
  const elementId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
        const rendered = await mermaid.render(`mermaid-${elementId}`, code);
        if (!cancelled) setSvg(rendered.svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, elementId]);

  if (failed) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) {
    return <div className="rounded border border-border bg-muted p-4 text-sm text-muted-foreground">Rendering diagram…</div>;
  }
  return <div className="mermaid-diagram my-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}
