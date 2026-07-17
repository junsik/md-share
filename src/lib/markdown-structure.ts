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
