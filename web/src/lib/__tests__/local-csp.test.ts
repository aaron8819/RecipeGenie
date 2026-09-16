import { describe, expect, it } from 'vitest';
import { localCspConnectionOrigin } from '../local-csp';

const local = {
  requestUrl: 'http://127.0.0.1:3117/shopping', target: 'local',
  host: '127.0.0.1:3117',
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
    { host: undefined }, { host: 'recipe-genie.example' },
    { host: 'localhost.evil.example' }, { host: 'evillocalhost' },
    { host: 'localhost.' }, { host: 'localhost:0' }, { host: 'localhost:65536' },
    { host: 'localhost:01' }, { host: '127.1' }, { host: '2130706433' },
    { host: '127.0.0.256' }, { host: '127.00.0.1' }, { host: 'localhost,localhost' },
    { host: 'user@localhost' }, { host: '[::1]:bad' }, { host: '::1' },
    { host: '[::ffff:127.0.0.1]' }, { host: '[::1%lo]' },
    { host: ' localhost' }, { host: 'localhost/' }, { host: 'localhost:' },
    { forwardedHost: 'recipe-genie.example' }, { forwarded: 'host=localhost' },
    { forwardedHost: '' }, { forwarded: '' },
    { host: 'recipe-genie.example', forwardedHost: 'localhost' },
  ])('fails closed outside explicit local verification: %j', override => {
    expect(localCspConnectionOrigin({ ...local, ...override })).toBeNull();
  });
  it.each(['localhost', 'LOCALHOST:3117', '127.0.0.1', '127.9.8.7:65535',
    '[::1]', '[::1]:3117', '[0:0:0:0:0:0:0:1]:80'])('accepts strict loopback Host %s', host => {
    expect(localCspConnectionOrigin({ ...local, host })).toBe(local.allowedOrigin);
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
