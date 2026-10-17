// Synthetic snapshots only. No credentials, database connection or mutations.
export const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const otherAccount = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function fixtures(size, userId = account) {
  return Array.from({ length: size }, (_, i) => {
    const total = [10, 20, 30][i % 3];
    const correct = Math.round(total * [1, 0.9, 0.75, 0.6, 0.4, 0.2][i % 6]);
    const direction = i % 2 ? 'geo-to-en' : 'en-to-geo';
    const date = new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 7) * 3600000).toISOString();
    return {
      id: `${userId.slice(0, 8)}-0000-4000-8000-${String(i).padStart(12, '0')}`,
      user_id: userId, test_date: date, created_at: date,
      test_direction: direction, total_words: total, correct_count: correct,
      mistakes: Array.from({ length: total - correct }, (_, j) => ({
        english_word: ['yield', 'spring', 'bear', 'consider', 'light'][j % 5],
        question_prompt: direction === 'en-to-geo' ? `meaning ${i}-${j}: yield` : `მნიშვნელობა ${i}-${j}: დათმობა`,
        user_answer: j % 4 ? `attempt ${i}-${j}` : '',
        correct_definitions: direction === 'en-to-geo' ? ['დათმობა', 'მოსავლიანობა'] : ['yield', 'give way'],
        description: `<p>Saved context ${i}-${j}: <strong>yield</strong> can describe giving way or producing a result. This sentence preserves the meaning used in this session.</p>`,
      })),
    };
  });
}

export function ordered(rows) {
  return [...rows].sort((a, b) => b.test_date.localeCompare(a.test_date) || b.id.localeCompare(a.id));
}
