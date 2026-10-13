import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deferred, supabaseMock } from '@/test/mocks';
import { word } from '@/test/fixtures';
import type { Word } from '@/lib/supabase';
import { useWords, type WordFormData } from './useWords';
import WordModal from './modals/WordModal';

const original = word({ updated_at: '2026-10-14T10:00:00.123456+00:00' });
const descriptionPlaceholder = 'Add additional context or example sentences...';
let clientSequence = 0;

async function database(initial: Word[] = [original]) {
  // Real SDK serialization/count parsing against an atomic in-memory transport.
  // This models the REQUIRED advancing DB trigger; it does not verify its SQL
  // or installation. See the separate R3-A01 prerequisite in supabase/README.md.
  const { createClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const rows = new Map(initial.map(row => [row.id, structuredClone(row)]));
  const control = { gate: Promise.resolve(), failNextPatch: false };
  let microseconds = 123456;
  const transport = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    const matches = (row: Word) => (['id', 'user_id', 'updated_at'] as const).every(column => {
      const condition = url.searchParams.get(column);
      return condition === null || condition === `eq.${row[column]}`;
    });
    if (options?.method === 'GET') {
      const found = [...rows.values()].filter(matches);
      return new Response(JSON.stringify(found), { headers: { 'Content-Type': 'application/json', 'Content-Range': `*/${found.length}` } });
    }
    if (options?.method !== 'PATCH') throw new Error('Unexpected transport operation');
    await control.gate;
    if (control.failNextPatch) {
      control.failNextPatch = false;
      return new Response(JSON.stringify({ message: 'private database details', code: 'XX000' }), { status: 500 });
    }
    // Match and modify without an intervening await, including after a competing
    // PATCH completes. Only filters actually sent by the client are applied.
    const found = [...rows.values()].filter(matches);
    const payload = JSON.parse(String(options.body));
    for (const row of found) {
      rows.set(row.id, { ...row, ...payload, updated_at: `2026-10-14T10:00:00.${++microseconds}+00:00` });
    }
    return new Response(null, { status: 204, headers: { 'Content-Range': `*/${found.length}` } });
  });
  const client = createClient('https://example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `word-concurrency-${++clientSequence}` },
    global: { fetch: transport },
  });
  supabaseMock.from.mockImplementation(table => client.from(table));
  return { rows, control, client, patches: () => transport.mock.calls.filter(([, options]) => options?.method === 'PATCH') };
}

function Editor({ snapshot, onSave }: { snapshot: Word; onSave: () => void }) {
  const { updateWord, addWord, checkExistingEnglishWords } = useWords();
  return <WordModal word={snapshot} onSave={onSave} onClose={() => {}} onDuplicateDetected={() => {}}
    updateWord={updateWord} addWord={addWord} checkExistingEnglishWords={checkExistingEnglishWords} />;
}

function formAt(index: number) {
  return screen.getAllByPlaceholderText('Enter the English word')[index].closest('form')!;
}

function change(form: HTMLFormElement, placeholder: string, value: string) {
  fireEvent.change(within(form).getByPlaceholderText(placeholder), { target: { value } });
}

function inputs(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'), input => input.value);
}

describe('word optimistic concurrency through the Supabase transport', () => {
  it('rejects the second stale editor, preserves its entire draft on repeated saves, and allows a freshly opened version', async () => {
    const db = await database();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const savedA = vi.fn();
    const savedB = vi.fn();
    const a = render(<Editor snapshot={structuredClone(original)} onSave={savedA} />);
    const b = render(<Editor snapshot={structuredClone(original)} onSave={savedB} />);
    const formA = formAt(0);
    const formB = formAt(1);
    change(formA, descriptionPlaceholder, '<b>Saved by A</b>');
    change(formB, 'Enter the English word', '  go  ');
    change(formB, 'Definition 1', ' წასვლა ');
    change(formB, 'Definition 2', 'სვლა');
    fireEvent.click(within(formB).getByRole('button', { name: 'Add definition' }));
    change(formB, 'Definition 3', 'მოძრაობა');
    fireEvent.click(within(formB).getByRole('button', { name: 'Irregular' }));
    change(formB, 'Enter past simple form', ' went ');
    change(formB, 'Enter past participle form', ' gone ');
    change(formB, descriptionPlaceholder, '<b>B draft</b> <span style="color: #EF4444">context</span>');
    const before = inputs(formB);

    await act(async () => fireEvent.submit(formA));
    expect(savedA).toHaveBeenCalledOnce();
    const committed = structuredClone(db.rows.get(original.id)!);
    expect(committed.description).toBe('<b>Saved by A</b>');
    expect(committed.updated_at).toBe('2026-10-14T10:00:00.123457+00:00');
    await act(async () => fireEvent.submit(formB));
    expect(db.rows.get(original.id)).toEqual(committed);
    expect(savedB).not.toHaveBeenCalled();
    expect(formB).toBeInTheDocument();
    expect(inputs(formB)).toEqual(before);
    expect(within(formB).getByRole('button', { name: 'Irregular' })).toBeEnabled();
    expect(alert).toHaveBeenLastCalledWith(expect.stringContaining('may have changed, been deleted, or become inaccessible'));
    expect(alert).toHaveBeenLastCalledWith(expect.stringContaining('Copy them, then reload and reopen'));
    expect(db.patches()).toHaveLength(2); // No automatic retry.
    await act(async () => fireEvent.submit(formB));
    expect(savedB).not.toHaveBeenCalled();
    expect(inputs(formB)).toEqual(before);
    expect(db.rows.get(original.id)).toEqual(committed);
    for (const [url, options] of db.patches()) {
      const params = new URL(String(url)).searchParams;
      expect(params.get('updated_at')).toBe(`eq.${original.updated_at}`);
      expect(params.get('id')).toBe(`eq.${original.id}`);
      expect(params.get('user_id')).toBe('eq.user-a');
      expect(new Headers(options?.headers).get('Prefer')).toContain('count=exact');
      expect(JSON.parse(String(options?.body))).not.toHaveProperty('updated_at');
    }
    expect(JSON.parse(String(db.patches()[1][1]?.body))).toMatchObject({
      part_of_speech: 'verb', is_irregular_verb: true, past_simple: 'went', past_participle: 'gone',
    });

    // Explicit recovery: copy the draft, close, load and reopen the latest row.
    a.unmount();
    b.unmount();
    const latest = await db.client.from('words').select('*').eq('id', original.id).eq('user_id', 'user-a');
    expect(latest.error).toBeNull();
    render(<Editor snapshot={latest.data![0] as Word} onSave={savedB} />);
    const reopened = formAt(0);
    expect(within(reopened).getByPlaceholderText(descriptionPlaceholder)).toHaveValue('<b>Saved by A</b>');
    change(reopened, descriptionPlaceholder, '<b>Saved by A</b>; reviewed addition from B');
    await act(async () => fireEvent.submit(reopened));
    expect(savedB).toHaveBeenCalledOnce();
    expect(new URL(String(db.patches()[3][0])).searchParams.get('updated_at')).toBe(`eq.${committed.updated_at}`);
    expect(db.rows.get(original.id)).toEqual({ ...committed,
      description: '<b>Saved by A</b>; reviewed addition from B', updated_at: '2026-10-14T10:00:00.123458+00:00',
    });
  });

  it('allows exactly one writer when both updates are already pending with the same original version', async () => {
    const db = await database();
    const gate = deferred<void>();
    db.control.gate = gate.promise;
    const { result } = renderHook(() => useWords());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const form: WordFormData = { englishWord: 'yield', georgianDefs: ['მოსავალი'], description: 'A',
      partOfSpeech: 'verb', isIrregularVerb: false, pastSimple: null, pastParticiple: null };
    const first = result.current.updateWord(original.id, form, original.updated_at);
    const second = result.current.updateWord(original.id, { ...form, description: 'B' }, original.updated_at);
    const outcomes = Promise.allSettled([first, second]);
    await waitFor(() => expect(db.patches()).toHaveLength(2));
    expect(db.rows.get(original.id)).toEqual(original);
    gate.resolve();
    const settled = await outcomes;
    expect(settled.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(outcome => outcome.status === 'rejected')).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('may have changed') }) },
    ]);
    expect(db.rows.get(original.id)?.description).toBe(settled[0].status === 'fulfilled' ? 'A' : 'B');
  });

  it('edits identical English words with different meaning IDs independently', async () => {
    const other = { ...original, id: 'another-meaning' };
    const db = await database([original, other]);
    const savedA = vi.fn();
    const savedB = vi.fn();
    render(<Editor snapshot={original} onSave={savedA} />);
    render(<Editor snapshot={other} onSave={savedB} />);
    change(formAt(0), descriptionPlaceholder, 'First meaning');
    change(formAt(1), descriptionPlaceholder, 'Second meaning');
    await act(async () => { fireEvent.submit(formAt(0)); fireEvent.submit(formAt(1)); });
    expect(savedA).toHaveBeenCalledOnce();
    expect(savedB).toHaveBeenCalledOnce();
    expect(db.rows.get(original.id)?.description).toBe('First meaning');
    expect(db.rows.get(other.id)?.description).toBe('Second meaning');
  });

  it.each(['deleted', 'inaccessible', 'database error'] as const)('retains the draft without reporting success when the record is %s', async kind => {
    const db = await database();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const saved = vi.fn();
    render(<Editor snapshot={original} onSave={saved} />);
    const form = formAt(0);
    change(form, descriptionPlaceholder, '<b>Keep this draft</b>');
    if (kind === 'deleted') db.rows.delete(original.id);
    if (kind === 'inaccessible') db.rows.set(original.id, { ...original, user_id: 'user-b' });
    if (kind === 'database error') db.control.failNextPatch = true;
    await act(async () => fireEvent.submit(form));
    expect(saved).not.toHaveBeenCalled();
    expect(within(form).getByPlaceholderText(descriptionPlaceholder)).toHaveValue('<b>Keep this draft</b>');
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(db.rows.get(original.id)?.description).not.toBe('<b>Keep this draft</b>');
    expect(alert).toHaveBeenCalledWith(expect.stringContaining(kind === 'database error'
      ? 'Unable to save your words. Please try again.'
      : 'may have changed, been deleted, or become inaccessible'));
    expect(db.patches()).toHaveLength(1);
  });
});
