import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './ThemeContext';

function Consumer() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return <><span>{theme}</span><button onClick={toggleTheme}>Toggle</button>
    <button onClick={() => setTheme('dark')}>Set dark</button></>;
}

afterEach(() => document.documentElement.classList.remove('dark'));

describe('Theme public API', () => {
  it('restores the saved preference and persists toggle/set updates through the existing import path', async () => {
    localStorage.setItem('vocab-app-theme', 'dark');
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByText('light')).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('vocab-app-theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'Set dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('vocab-app-theme')).toBe('dark');
  });

  it('uses the system preference when no saved preference exists', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(localStorage.getItem('vocab-app-theme')).toBe('dark');
  });

  it('retains the missing-provider error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const expectedError = 'useTheme must be used within a ThemeProvider';
    const onError = (event: ErrorEvent) => {
      if (event.error?.message === expectedError) event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      expect(() => renderHook(() => useTheme())).toThrow(expectedError);
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});
