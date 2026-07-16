export const MAX_TITLE_LENGTH = 200;
export const MAX_FILENAME_LENGTH = 255;

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; code: string; message: string };

export function validateMarkdownFilename(filename: string): ValidationResult {
  const value = filename.trim();
  if (!value || value.length > MAX_FILENAME_LENGTH) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      message: `filename must be between 1 and ${MAX_FILENAME_LENGTH} characters`
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(value) || value.includes("/") || value.includes("\\")) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      message: "filename must not contain paths or control characters"
    };
  }
  if (!value.toLowerCase().endsWith(".md") || value.length === 3) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "only .md files are supported"
    };
  }
  return { ok: true, value };
}

export function validateMarkdownText(markdown: string):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (!markdown.trim()) {
    return {
      ok: false,
      code: "EMPTY_MARKDOWN",
      message: "markdown must be a non-empty string"
    };
  }
  if (markdown.includes("\u0000")) {
    return {
      ok: false,
      code: "BINARY_MARKDOWN",
      message: "markdown must not contain NUL bytes"
    };
  }
  return { ok: true };
}
