import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import {
  DOCUMENT_HEADING_ID_PREFIX,
  type DocumentHeading
} from "@/lib/heading-anchors";

function firstContentLine(lines: string[]): number {
  return lines.findIndex((line) => line.trim().length > 0);
}

export function hasLeadingH1(markdown: string): boolean {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const index = firstContentLine(lines);
  if (index < 0) return false;

  const line = lines[index];
  if (/^ {0,3}#[\t ]+\S/.test(line)) return true;

  const underline = lines[index + 1];
  return /^ {0,3}\S.*$/.test(line) && Boolean(underline && /^ {0,3}=+[\t ]*$/.test(underline));
}

export function extractDocumentHeadings(markdown: string): DocumentHeading[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const slugger = new GithubSlugger();
  const headings: DocumentHeading[] = [];

  visit(tree, "heading", (node) => {
    const text = toString(node).trim();
    const id = `${DOCUMENT_HEADING_ID_PREFIX}${slugger.slug(text)}`;
    if (!text || (node.depth !== 2 && node.depth !== 3)) return;
    headings.push({ id, level: node.depth, text });
  });

  return headings;
}
