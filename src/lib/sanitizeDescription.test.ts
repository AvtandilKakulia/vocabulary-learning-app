import { describe, expect, it, vi } from 'vitest';
import { sanitizeDescription } from './sanitizeDescription';

describe('sanitizeDescription', () => {
  it('preserves safe text and strong formatting, escaping text entities', () => {
    expect(sanitizeDescription('Safe &amp; <strong>important</strong>'))
      .toBe('Safe &amp; <strong>important</strong>');
    expect(sanitizeDescription('')).toBe('');
  });

  it('keeps only a six-digit hex span color and normalizes its case', () => {
    expect(sanitizeDescription('<span id="x" style=" color: #AbCdEf; ">color</span>'))
      .toBe('<span style="color: #abcdef">color</span>');
    expect(sanitizeDescription('<span style="color: red; background: url(evil)">text</span>'))
      .toBe('<span>text</span>');
  });

  it('removes script/style contents, unsafe tags, and event attributes', () => {
    expect(sanitizeDescription(
      '<script>evil()</script><style>body{display:none}</style>' +
      '<a href="javascript:evil()">link</a><img src="bad" onerror="evil()">' +
      '<strong onclick="evil()">bold</strong><span onmouseover="evil()">plain</span>',
    )).toBe('link<strong>bold</strong><span>plain</span>');
  });

  it('converts literal newlines to line breaks, including inside formatting', () => {
    expect(sanitizeDescription('first\n<strong>second\nthird</strong>'))
      .toBe('first<br><strong>second<br>third</strong>');
  });

  it('escapes markup and preserves newlines when DOMParser is unavailable', () => {
    vi.stubGlobal('DOMParser', undefined);
    expect(sanitizeDescription('<strong>safe</strong>\n&'))
      .toBe('&lt;strong&gt;safe&lt;/strong&gt;<br>&amp;');
  });
});
