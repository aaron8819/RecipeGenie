import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardMealImage } from '../dashboard-meal-image';
import { createRequire } from 'node:module';
import { matchRemotePattern } from 'next/dist/shared/lib/match-remote-pattern';

const nextConfig = createRequire(import.meta.url)('../../../../next.config.js');
globalThis.React = React;
vi.mock('next/image', () => ({ default: ({ unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) =>
  // eslint-disable-next-line @next/next/no-img-element
  <img {...props} data-direct={String(unoptimized)} alt="" /> }));
describe('Dashboard photo policy', () => {
  it.each([
    ['https://example.com/photo.jpg', true], ['http://127.0.0.1:54321/storage/v1/object/public/recipe-images/a.jpg', true],
    ['https://project.supabase.co/storage/v1/object/public/recipe-images/a.jpg', false], ['/photo.png', true],
    ['https://project.supabase.co.evil.test/photo.jpg', true],
    ['https://project.supabase.co/storage/v1/object/sign/recipe-images/a.png?token=fixture', true],
    ['https://project.supabase.co/storage/v1/object/authenticated/recipe-images/a.png', true],
    ['https://project.supabase.co/private.png', true],
    ['https://nested.project.supabase.co/storage/v1/object/public/a.png', false],
    ['https://project.supabase.co:444/storage/v1/object/public/a.png', false],
  ])('renders %s without unsupported optimizer admission', (src, direct) => {
    const { container } = render(<DashboardMealImage src={src} />);
    expect(container.querySelector('img')).toHaveAttribute('data-direct', String(direct));
    if (src.startsWith('https:')) {
      // Use Next's real policy matcher as the oracle, rather than inferring
      // admission from our mocked Image's rendering behavior.
      const admitted = nextConfig.images.remotePatterns.some((pattern: Parameters<typeof matchRemotePattern>[0]) =>
        matchRemotePattern(pattern, new URL(src)));
      expect(direct).toBe(!admitted);
    }
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
