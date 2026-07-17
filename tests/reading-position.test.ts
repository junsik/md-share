import { describe, expect, it } from "vitest";
import {
  calculateReadingProgress,
  findActiveHeadingId
} from "@/lib/reading-position";

describe("document reading position", () => {
  it("measures progress from the Markdown content bounds", () => {
    const input = { viewportHeight: 800, contentTop: 200, contentHeight: 2400 };

    expect(calculateReadingProgress({ ...input, scrollY: 0 })).toBe(0);
    expect(calculateReadingProgress({ ...input, scrollY: 200 })).toBe(0);
    expect(calculateReadingProgress({ ...input, scrollY: 1000 })).toBe(0.5);
    expect(calculateReadingProgress({ ...input, scrollY: 1800 })).toBe(1);
    expect(calculateReadingProgress({ ...input, scrollY: 2400 })).toBe(1);
  });

  it("handles content shorter than the viewport", () => {
    const input = { viewportHeight: 800, contentTop: 200, contentHeight: 400 };

    expect(calculateReadingProgress({ ...input, scrollY: 199 })).toBe(0);
    expect(calculateReadingProgress({ ...input, scrollY: 200 })).toBe(1);
  });

  it("selects the last heading above the reading marker", () => {
    const headings = [
      { id: "heading-summary", top: 300 },
      { id: "heading-findings", top: 900 },
      { id: "heading-next", top: 1500 }
    ];

    expect(findActiveHeadingId([], 0, 900)).toBeNull();
    expect(findActiveHeadingId(headings, 0, 900)).toBe("heading-summary");
    expect(findActiveHeadingId(headings, 760, 900)).toBe("heading-findings");
    expect(findActiveHeadingId(headings, 1400, 900)).toBe("heading-next");
  });
});
