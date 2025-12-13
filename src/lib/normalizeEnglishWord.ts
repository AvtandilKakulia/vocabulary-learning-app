export function normalizeEnglishWord(input: string): string {
  if (!input) return '';
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}
