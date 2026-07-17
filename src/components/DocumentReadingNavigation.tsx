"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentHeading } from "@/lib/heading-anchors";
import {
  calculateReadingProgress,
  findActiveHeadingId,
  type HeadingPosition
} from "@/lib/reading-position";

interface DocumentReadingNavigationProps {
  contentId: string;
  headings: DocumentHeading[];
}

interface TableOfContentsProps {
  activeId: string | null;
  headings: DocumentHeading[];
  onNavigate?: () => void;
}

function TableOfContents({ activeId, headings, onNavigate }: TableOfContentsProps) {
  return (
    <ol className="mt-3 space-y-1 text-sm">
      {headings.map((heading) => {
        const active = heading.id === activeId;
        return (
          <li key={heading.id} className={heading.level === 3 ? "pl-4" : ""}>
            <a
              href={`#${heading.id}`}
              aria-current={active ? "location" : undefined}
              data-heading-id={heading.id}
              onClick={onNavigate}
              className={`block border-l-2 py-1.5 pl-3 leading-5 transition-colors motion-reduce:transition-none ${
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {heading.text}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export default function DocumentReadingNavigation({
  contentId,
  headings
}: DocumentReadingNavigationProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const frameRef = useRef<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const content = document.getElementById(contentId);
    if (!content) return;

    const update = () => {
      frameRef.current = null;
      const scrollY = window.scrollY;
      const viewportHeight = window.innerHeight;
      const contentRect = content.getBoundingClientRect();
      const contentTop = contentRect.top + scrollY;
      const headingPositions = headings.flatMap<HeadingPosition>((heading) => {
        const element = document.getElementById(heading.id);
        return element
          ? [{ id: heading.id, top: element.getBoundingClientRect().top + scrollY }]
          : [];
      });

      const nextProgress = calculateReadingProgress({
        scrollY,
        viewportHeight,
        contentTop,
        contentHeight: contentRect.height
      });
      const nextActiveId = findActiveHeadingId(headingPositions, scrollY, viewportHeight);
      setProgress((current) => (Math.abs(current - nextProgress) < 0.001 ? current : nextProgress));
      setActiveId((current) => (current === nextActiveId ? current : nextActiveId));
    };

    const scheduleUpdate = () => {
      if (frameRef.current == null) frameRef.current = window.requestAnimationFrame(update);
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(content);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [contentId, headings]);

  const progressPercent = Math.round(progress * 100);
  const closeMobileNavigation = () => {
    window.requestAnimationFrame(() => detailsRef.current?.removeAttribute("open"));
  };

  return (
    <>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
        data-reading-progress
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent"
      >
        <div
          className="h-full origin-left bg-primary transition-transform duration-100 motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <aside className="xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1" data-document-toc>
        <details ref={detailsRef} className="rounded-xl border border-border bg-card px-4 py-3 xl:hidden">
          <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
            On this page
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {headings.length} sections
            </span>
          </summary>
          <nav aria-label="On this page">
            <TableOfContents
              activeId={activeId}
              headings={headings}
              onNavigate={closeMobileNavigation}
            />
          </nav>
        </details>

        <nav aria-label="On this page" className="hidden xl:block">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            On this page
          </p>
          <TableOfContents activeId={activeId} headings={headings} />
        </nav>
      </aside>
    </>
  );
}
