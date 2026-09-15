import { describe, expect, it } from 'vitest';
import { localCspConnectionOrigin } from '../local-csp';

const local = {
  requestUrl: 'http://127.0.0.1:3117/shopping', target: 'local',
  allowedOrigin: 'http://127.0.0.1:57321', supabaseUrl: 'http://127.0.0.1:57321',
};
describe('local production-build CSP', () => {
  it('adds only the explicit matching loopback origin', () => {
    expect(localCspConnectionOrigin(local)).toBe(local.allowedOrigin);
  });
  it.each([
    { target: undefined }, { target: 'production' }, { allowedOrigin: undefined },
    { supabaseUrl: 'https://example.supabase.co' },
    { requestUrl: 'https://recipe-genie.example/shopping' },
    { requestUrl: 'http://recipe-genie.example/shopping' },
    { requestUrl: 'https://localhost:3117/shopping' },
    { vercel: '1' }, { vercel: '' },
  ])('fails closed outside explicit local verification: %j', override => {
    expect(localCspConnectionOrigin({ ...local, ...override })).toBeNull();
  });
  it.each([
    'http://localhost:*', 'http://localhost', 'http://127.0.0.2:57321',
    'https://example.supabase.co', 'http://localhost:57321/path',
    'http://user:password@localhost:57321', 'http://localhost:57321?x=1',
    'http://localhost:57321#x', 'http://localhost:57321/; https://evil.example',
    'http://localhost.evil.example:57321', 'not a URL',
  ])('rejects unsafe or non-origin configuration: %s', origin => {
    expect(localCspConnectionOrigin({ ...local, allowedOrigin: origin, supabaseUrl: origin })).toBeNull();
  });
});
