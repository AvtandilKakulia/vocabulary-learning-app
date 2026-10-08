import { describe, expect, it } from 'vitest';
import { normalizeEnglishWord } from './normalizeEnglishWord';
import { normalizeGeorgianDefs } from './normalizeGeorgianDefs';

describe('normalizeEnglishWord', () => {
  it.each([
    ['  Yield  ', 'yield'],
    ['TAKE   \t OFF\n', 'take off'],
    ['', ''],
    [' \t\n ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeEnglishWord(input)).toBe(expected);
  });
});

describe('normalizeGeorgianDefs', () => {
  it('collapses whitespace, removes blanks/exact duplicates, and retains first occurrence order', () => {
    expect(normalizeGeorgianDefs([
      '  გზა   დათმე ', '', ' \t ', 'მოსავალი', 'გზა\nდათმე', 'მოსავალი', 'დათმობა',
    ])).toEqual(['გზა დათმე', 'მოსავალი', 'დათმობა']);
  });

  it('returns an empty list when there are no definitions', () => {
    expect(normalizeGeorgianDefs([])).toEqual([]);
    expect(normalizeGeorgianDefs(['', '  '])).toEqual([]);
  });
});
