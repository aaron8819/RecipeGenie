import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalCalendarDate } from '../use-local-calendar-date';

afterEach(() => vi.useRealTimers());

describe('Dashboard local calendar', () => {
  it('does not render the server timezone date before hydration', () => {
    function Calendar() {
      return createElement('span', null, useLocalCalendarDate() ?? 'Loading');
    }
    expect(renderToString(createElement(Calendar))).toBe('<span>Loading</span>');
  });

  it('advances at local midnight across a year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
    const { result, unmount } = renderHook(useLocalCalendarDate);
    expect(result.current).toBe('2026-12-31');
    act(() => vi.advanceTimersByTime(1100));
    expect(result.current).toBe('2027-01-01');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes a suspended tab when visibility or focus returns', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 10));
    const { result } = renderHook(useLocalCalendarDate);
    vi.setSystemTime(new Date(2026, 9, 2, 10));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe('2026-10-02');
    vi.setSystemTime(new Date(2026, 9, 4, 10));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toBe('2026-10-04');
  });
});
