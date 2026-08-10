import React, { type AnchorHTMLAttributes, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomNav } from '../bottom-nav'

globalThis.React = React

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: true }),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/recipes',
}))

describe('bottom navigation pending feedback', () => {
  it('highlights a link while its route is pending', () => {
    render(<BottomNav />)

    const pendingText = screen.getByText('Loading Planner')
    const plannerLink = pendingText.closest('a')

    expect(plannerLink).toHaveAttribute('href', '/planner')
    expect(plannerLink?.querySelector('svg')).toHaveClass('animate-pulse')
    expect(plannerLink?.querySelector('.text-primary')).toHaveTextContent(
      'Planner'
    )
  })
})
