import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'dotenv';

const local = parse(readFileSync('.env.local'));
assert.equal(local.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const origin = local.NEXT_PUBLIC_SUPABASE_URL;
const results = [];
const configurations = [
  ['local', {}, true],
  ['default', { RECIPE_GENIE_E2E_TARGET: '' }, false],
  ['opt-out', { RECIPE_GENIE_LOCAL_CSP_ORIGIN: '' }, false],
  ['hosted', { RECIPE_GENIE_E2E_TARGET: 'production' }, false],
  ['vercel', { VERCEL: '1' }, false],
  ['vercel-empty', { VERCEL: '' }, false],
  ['mismatch', { RECIPE_GENIE_LOCAL_CSP_ORIGIN: 'http://127.0.0.1:57329' }, false],
  ['wildcard', { RECIPE_GENIE_LOCAL_CSP_ORIGIN: 'http://127.0.0.1:*' }, false],
];
const authorities = [
  ['127.0.0.1:3119', true], ['localhost:3119', true], ['LOCALHOST', true],
  ['127.2.3.4:65535', true], ['[::1]:3119', true], ['[0:0:0:0:0:0:0:1]', true],
  ['recipe-genie.example', false], ['localhost.example', false], ['evillocalhost', false],
  ['localhost.', false], ['localhost:0', false], ['localhost:65536', false],
  ['localhost:01', false], ['localhost:bad', false], ['localhost:', false],
  ['127.1', false], ['2130706433', false], ['127.00.0.1', false], ['127.0.0.256', false],
  ['[::ffff:127.0.0.1]', false], ['::1', false], ['[::1%lo]', false],
  ['localhost,recipe-genie.example', false], ['user@localhost', false], ['localhost/path', false],
];
function get(headers) {
  return new Promise((resolve, reject) => {
    const req = request('http://127.0.0.1:3119/shopping', { headers }, response => {
      response.resume(); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    req.on('error', reject); req.end();
  });
}
for (const [name, overrides, enabled] of configurations) {
  const env = { ...process.env, ...local, ...overrides };
  if (!Object.hasOwn(overrides, 'VERCEL')) delete env.VERCEL;
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3119'],
    { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Readiness timeout: ${output}`)), 30000);
      child.stdout.on('data', b => { output += b; if (output.includes('Ready in')) { clearTimeout(timeout); resolve(); } });
      child.stderr.on('data', b => { output += b; });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    });
    const cases = authorities.map(([host, allowed]) => [host, { host }, enabled && allowed]);
    cases.push(
      ['forwarded-spoof', { host: 'recipe-genie.example', 'x-forwarded-host': 'localhost:3119' }, false],
      ['forwarded-conflict', { host: 'localhost:3119', 'x-forwarded-host': 'recipe-genie.example' }, false],
      ['forwarded-list', { host: 'localhost:3119', 'x-forwarded-host': 'localhost:3119, recipe-genie.example' }, false],
      ['forwarded-standard', { host: 'localhost:3119', forwarded: 'host=localhost:3119;proto=http' }, false],
      ['forwarded-empty', { host: 'localhost:3119', forwarded: '' }, false],
      ['forwarded-host-empty', { host: 'localhost:3119', 'x-forwarded-host': '' }, false],
      ['forwarded-same', { host: 'localhost:3119', 'x-forwarded-host': 'localhost:3119' }, enabled],
    );
    for (const [label, headers, allowed] of cases) {
      const response = await get(headers);
      const csp = response.headers['content-security-policy'] ?? '';
      const connect = csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'));
      const expected = "connect-src 'self' https://*.supabase.co wss://*.supabase.co" + (allowed ? ` ${origin}` : '');
      // Invalid authorities may be rejected by the HTTP/Next boundary first.
      const rejected = response.status >= 400 && !csp;
      const pass = allowed ? connect === expected : rejected || connect === expected;
      const cacheSafe = !allowed || /no-store/.test(response.headers['cache-control'] ?? '');
      results.push({ name, label, pass: pass && cacheSafe, ...response, expected });
      console.log(`${pass && cacheSafe ? 'PASS' : 'FAIL'} ${name}/${label}`);
    }
  } finally {
    child.kill(); await new Promise(resolve => child.once('exit', resolve));
  }
}
mkdirSync('../.codex-artifacts/review', { recursive: true });
writeFileSync('../.codex-artifacts/review/csp-authority-results.json', JSON.stringify({ complete: true, results }, null, 2));
if (results.some(result => !result.pass)) process.exitCode = 1;
