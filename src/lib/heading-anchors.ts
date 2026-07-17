export const DOCUMENT_HEADING_ID_PREFIX = "heading-";

export interface DocumentHeading {
  id: string;
  level: 2 | 3;
  text: string;
}
