/* Requirement → issues decomposition helpers. Split multi-line requirement
   text (acceptance criteria, fallback PRD description) into issue titles:
   drop blank lines, strip leading list markers ("- ", "* ", "1.", "1、"…),
   trim, and truncate overlong titles. Shared by the decompose API (server)
   and the detail-drawer confirm preview (client). */

export const DECOMPOSE_MAX_ITEMS = 20;
export const DECOMPOSE_TITLE_MAX = 120;

const LIST_MARKER = /^\s*(?:[-*•·]\s*|\d+\s*[.、)）]\s*)/;

export function splitDecompositionItems(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.replace(LIST_MARKER, '').trim())
    .filter(Boolean);
}

export function truncateIssueTitle(title: string): string {
  return title.length > DECOMPOSE_TITLE_MAX ? `${title.slice(0, DECOMPOSE_TITLE_MAX - 1)}…` : title;
}

/* Acceptance criteria win; the PRD description is the fallback when the
   criteria split to nothing. Capped at DECOMPOSE_MAX_ITEMS. */
export function decompositionItemsFor(req: {
  acceptanceCriteria?: string | null;
  description?: string | null;
}): string[] {
  const items = splitDecompositionItems(req.acceptanceCriteria);
  const source = items.length ? items : splitDecompositionItems(req.description);
  return source.slice(0, DECOMPOSE_MAX_ITEMS).map(truncateIssueTitle);
}
