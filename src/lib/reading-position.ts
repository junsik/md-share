export interface ReadingProgressInput {
  scrollY: number;
  viewportHeight: number;
  contentTop: number;
  contentHeight: number;
}

export interface HeadingPosition {
  id: string;
  top: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateReadingProgress({
  scrollY,
  viewportHeight,
  contentTop,
  contentHeight
}: ReadingProgressInput): number {
  const readingDistance = contentHeight - viewportHeight;
  if (readingDistance <= 0) return scrollY >= contentTop ? 1 : 0;
  return clamp((scrollY - contentTop) / readingDistance, 0, 1);
}

export function findActiveHeadingId(
  headings: HeadingPosition[],
  scrollY: number,
  viewportHeight: number
): string | null {
  if (headings.length === 0) return null;

  const marker = scrollY + Math.min(160, viewportHeight * 0.25);
  let activeId = headings[0].id;
  for (const heading of headings) {
    if (heading.top > marker) break;
    activeId = heading.id;
  }
  return activeId;
}
