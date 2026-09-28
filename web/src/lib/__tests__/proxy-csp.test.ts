import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../../proxy';

afterEach(() => vi.unstubAllEnvs());
describe('production proxy CSP', () => {
  const hosted = "connect-src 'self' https://*.supabase.co wss://*.supabase.co";
  function policy(url: string) {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:57321');
    return proxy(new NextRequest(url, { headers: { host: new URL(url).host } })).headers.get('content-security-policy')!;
  }
  it('keeps the existing hosted policy with no opt-in', () => {
    vi.stubEnv('RECIPE_GENIE_E2E_TARGET', undefined);
    expect(policy('http://127.0.0.1:3117/shopping')).toContain(hosted + ';');
  });
  it('stays restrictive even with local opt-in and loopback authority', () => {
    vi.stubEnv('RECIPE_GENIE_E2E_TARGET', 'local');
    vi.stubEnv('RECIPE_GENIE_LOCAL_CSP_ORIGIN', 'http://127.0.0.1:57321');
    vi.stubEnv('VERCEL', undefined);
    expect(policy('http://127.0.0.1:3117/shopping')).toContain(hosted + ';');
    expect(policy('https://recipe-genie.example/shopping')).toContain(hosted + ';');
    vi.stubEnv('VERCEL', '1');
    const csp = policy('http://127.0.0.1:3117/shopping');
    expect(csp).toContain(hosted + ';');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
  });
});
