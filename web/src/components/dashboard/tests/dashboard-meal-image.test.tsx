import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardMealImage } from '../dashboard-meal-image';
globalThis.React = React;
vi.mock('next/image', () => ({ default: ({ unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) =>
  // eslint-disable-next-line @next/next/no-img-element
  <img {...props} data-direct={String(unoptimized)} alt="" /> }));
describe('Dashboard photo policy', () => {
  it.each([
    ['https://example.com/photo.jpg', true], ['http://127.0.0.1:54321/storage/v1/object/public/recipe-images/a.jpg', true],
    ['https://project.supabase.co/storage/v1/object/public/recipe-images/a.jpg', false], ['/photo.png', true],
    ['https://project.supabase.co.evil.test/photo.jpg', true],
  ])('renders %s without unsupported optimizer admission', (src, direct) => {
    const { container } = render(<DashboardMealImage src={src} />);
    expect(container.querySelector('img')).toHaveAttribute('data-direct', String(direct));
  });
  it('renders missing and failed photos as a fallback, and recovers for a new URL', () => {
    const { container, rerender } = render(<DashboardMealImage src={null} />);
    expect(container.querySelector('img')).toBeNull();
    rerender(<DashboardMealImage src="https://example.com/failure.jpg" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(<DashboardMealImage src="/working.png" />);
    expect(container.querySelector('img')).toBeTruthy();
  });
});
