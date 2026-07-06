import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarkdownView from "@/components/MarkdownView";
import { getDocument } from "@/lib/store";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const document = await getDocument(id);
  return { title: document ? `${document.meta.title} | md-share` : "md-share" };
}

function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export default async function DocumentPage({ params }: PageProps) {
  const { id } = await params;
  const document = await getDocument(id);
  if (!document) notFound();

  const { meta } = document;
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{meta.title}</h1>
          <nav className="flex items-center gap-3 text-sm">
            <a
              href={`/api/documents/${meta.id}/raw`}
              className="rounded border border-border bg-card px-3 py-1.5 text-muted-foreground hover:text-foreground"
            >
              Raw .md
            </a>
            <Link
              href="/"
              className="rounded border border-border bg-card px-3 py-1.5 text-muted-foreground hover:text-foreground"
            >
              Share new
            </Link>
          </nav>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Created {formatUtc(meta.createdAt)}
          {meta.expiresAt ? ` · expires ${formatUtc(meta.expiresAt)}` : ""}
        </p>
      </header>
      <main className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <MarkdownView markdown={document.markdown} />
      </main>
    </div>
  );
}
