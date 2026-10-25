import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { word } from '@/test/fixtures';
import ViewWordModal from './ViewWordModal';

describe('View Word Description surface', () => {
  it('distinguishes the scrollable section and preserves safe rich text, colors and stored masks', () => {
    const description = '<strong>ქართული</strong><br><span style="color: #2563eb">colored</span> <span data-study-mask="true">study</span>' +
      '<script>bad()</script><img src="x" onerror="bad()"><span onclick="bad()">safe</span>' + ' long context'.repeat(100);
    render(<ViewWordModal word={word({ description, english_word: 'pneumonoultramicroscopicsilicovolcanoconiosis' })} onClose={vi.fn()} />);
    const panel = screen.getByRole('region', { name: 'Word description' });
    expect(panel).toHaveClass('bg-slate-100', 'border-slate-300', 'overflow-y-auto', 'dark:bg-transparent', 'dark:bg-gradient-to-r', 'dark:border-gray-600');
    expect(panel.closest('.fixed')!.firstElementChild).toHaveClass('bg-white', 'dark:bg-gray-800/95');
    expect(screen.getByRole('heading', { name: 'Pneumonoultramicroscopicsilicovolcanoconiosis' })).toHaveClass('max-w-full', 'break-words');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('shrink-0', 'focus-visible:ring-2');
    expect(panel.querySelector('strong')).toHaveTextContent('ქართული');
    expect(panel.querySelector('[style]')).toHaveStyle({ color: '#2563eb' });
    expect(panel.querySelector('[data-study-mask]')).toHaveTextContent('study');
    expect(panel.querySelector('script, img, [onclick], [onerror]')).toBeNull();
    expect(panel.textContent).toContain(' long context'.repeat(100));
  });

  it.each(['Close', 'Escape', 'Edit'] as const)('preserves %s and exact word identity', async action => {
    const entry = word({ id: 'separate-meaning', description: 'A saved description' });
    const onClose = vi.fn(), onEdit = vi.fn();
    render(<ViewWordModal word={entry} onClose={onClose} onEdit={onEdit} />);
    if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else {
      screen.getByRole('button', { name: action }).focus();
      await userEvent.keyboard('{Enter}');
    }
    if (action === 'Edit') {
      expect(onEdit).toHaveBeenCalledExactlyOnceWith(entry);
      expect(onClose).not.toHaveBeenCalled();
    } else {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onEdit).not.toHaveBeenCalled();
    }
  });
});
