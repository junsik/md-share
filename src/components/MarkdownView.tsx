"use client";

import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import MermaidBlock from "./MermaidBlock";

function extractMermaidCode(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const element = children as ReactElement<{ className?: string; children?: ReactNode }>;
  const className = element.props.className ?? "";
  if (!className.split(/\s+/).includes("language-mermaid")) return null;
  const code = element.props.children;
  if (typeof code === "string") return code;
  if (Array.isArray(code) && code.every((part) => typeof part === "string")) {
    return code.join("");
  }
  return null;
}

function Pre(props: ComponentProps<"pre">) {
  const mermaidCode = extractMermaidCode(props.children);
  if (mermaidCode != null) {
    return <MermaidBlock code={mermaidCode.trim()} />;
  }
  return <pre {...props} />;
}

export default function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <article className="prose prose-invert max-w-none prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
        components={{ pre: Pre }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
