export type FormattingType = 'bold' | 'color';

export function applyFormatting(
  text: string,
  selection: { start: number; end: number },
  format: FormattingType,
  color?: string
): { nextText: string; nextCursor: number } | null {
  const clampedStart = Math.max(0, Math.min(selection.start, text.length));
  const clampedEnd = Math.max(clampedStart, Math.min(selection.end, text.length));

  if (clampedStart === clampedEnd) {
    return null;
  }

  const selectedText = escapeHtml(text.slice(clampedStart, clampedEnd));
  let formattedText: string | null = null;

  if (format === 'bold') {
    formattedText = `<strong>${selectedText}</strong>`;
  } else if (format === 'color') {
    const hexPattern = /^#([0-9a-fA-F]{6})$/;
    if (!color || !hexPattern.test(color)) {
      return null;
    }
    formattedText = `<span style="color: ${color}">${selectedText}</span>`;
  }

  if (!formattedText) {
    return null;
  }

  const nextText = `${text.slice(0, clampedStart)}${formattedText}${text.slice(clampedEnd)}`;
  const nextCursor = clampedStart + formattedText.length;

  return { nextText, nextCursor };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
