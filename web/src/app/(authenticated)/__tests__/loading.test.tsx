import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AuthenticatedRouteLoading from '../loading'

globalThis.React = React

describe('authenticated route loading', () => {
  it('provides immediate route transition feedback', () => {
    render(<AuthenticatedRouteLoading />)

    expect(screen.getByRole('status', { name: 'Loading page' })).toBeVisible()
  })
})
