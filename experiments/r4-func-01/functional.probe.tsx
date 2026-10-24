import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '../../src/test/mocks';
import UserProfile from '../../src/components/UserProfile';
import { ThemeProvider } from '../../src/contexts/ThemeProvider';
import ErrorBoundary from '../../src/components/ErrorBoundary';
import TestMode from '../../src/components/TestMode';
import { persistActiveTest, readTestRecovery } from '../../src/lib/activeTestSessions';

// These assertions document PRESENT defects, not desired fixed behavior.
// Never include this opt-in diagnostic in the application acceptance suite.
describe('R4-FUNC-01 current-behavior counterexamples', () => {
  it('FUNC-003: two restored Test editors can roll back the same saved question progress', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    expect(persistActiveTest({ id, userId: 'user-a', startedAt: '2026-01-01T00:00:00Z',
      direction: 'geo-to-en', inputType: 'text', wordCount: 0, customCount: '2',
      questions: ['cat', 'dog'].map(name => ({ id: name, english_word: name, georgian_definitions: [name],
        description: null, userAnswer: '', isCorrect: false, options: [] })),
      currentQuestion: 0, draftAnswer: '' })).toBe(true);
    const first = within(render(<TestMode />).container);
    const second = within(render(<TestMode />).container);
    fireEvent.change(first.getByPlaceholderText('Type your answer...'), { target: { value: 'cat' } });
    fireEvent.click(first.getByRole('button', { name: 'Next Question' }));
    expect(readTestRecovery('user-a').sessions[0].currentQuestion).toBe(1);
    fireEvent.change(second.getByPlaceholderText('Type your answer...'), { target: { value: 'stale draft' } });
    expect(readTestRecovery('user-a').sessions[0]).toMatchObject({ id, currentQuestion: 0, draftAnswer: 'stale draft' });
    expect(readTestRecovery('user-a').sessions[0].questions[0]).toMatchObject({ userAnswer: '', isCorrect: false });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
  it('FUNC-001: A profile save can invoke an email mutation while B is current', async () => {
    authMock.user = { id: 'user-a', email: 'a@example.com' };
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    supabaseMock.from.mockReturnValueOnce(query({ data: { display_name: 'A' }, error: null }))
      .mockReturnValueOnce(save)
      .mockReturnValueOnce(query({ data: { display_name: 'B' }, error: null }));
    const invocations: unknown[] = [];
    supabaseMock.auth.updateUser.mockImplementation(async payload => {
      invocations.push({ currentUid: authMock.user?.id, payload });
      return { error: null };
    });
    const updated = vi.fn();
    const { rerender } = render(<UserProfile onClose={vi.fn()} onProfileUpdated={updated} />);
    await screen.findByDisplayValue('a@example.com');
    fireEvent.change(screen.getByDisplayValue('a@example.com'), { target: { value: 'a-new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(save.upsert).toHaveBeenCalledWith({ id: 'user-a', display_name: 'A' });
    authMock.user = { id: 'user-b', email: 'b@example.com' };
    rerender(<UserProfile onClose={vi.fn()} onProfileUpdated={updated} />);
    await screen.findByDisplayValue('b@example.com');
    expect(invocations).toEqual([]);
    vi.useFakeTimers();
    await act(async () => pending.resolve({ error: null }));
    expect(invocations).toEqual([{ currentUid: 'user-b', payload: { email: 'a-new@example.com' } }]);
    expect(screen.getByText('Profile updated! Please check your email to confirm the new email address.')).toBeInTheDocument();
    expect(updated).toHaveBeenCalledOnce();
  });

  it.each(['getItem', 'setItem'] as const)('FUNC-002: theme %s failure escapes the provider', method => {
    const failure = new DOMException('Audit blocked theme storage', 'SecurityError');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const storage = vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw failure; });
    // React logs an expected caught render/effect exception; no rejection listener is suppressed.
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<ErrorBoundary><ThemeProvider><p>Usable workspace</p></ThemeProvider></ErrorBoundary>);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.queryByText('Usable workspace')).not.toBeInTheDocument();
      expect(diagnostic).toHaveBeenCalled();
    } finally { storage.mockRestore(); diagnostic.mockRestore(); }
  });
});
