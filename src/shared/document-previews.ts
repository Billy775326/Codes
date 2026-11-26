export function documentPreviewFormat(path: string) {
  if (/\.docx?$/i.test(path)) return 'word';
  if (/\.pdf$/i.test(path)) return 'pdf';
  return undefined;
}

export type DocumentPreview =
  { format: 'word'; text: string; truncated: boolean; version?: string } | { format: 'pdf' };
export type DocumentPreviewRead = DocumentPreview | { format: 'unchanged'; version: string };
