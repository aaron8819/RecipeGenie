import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'dotenv';

const local = parse(readFileSync('.env.local'));
assert.equal(local.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const origin = local.NEXT_PUBLIC_SUPABASE_URL;
const baseConnect = "connect-src 'self' https://*.supabase.co wss://*.supabase.co";
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
  ['localhost:1', true], ['[::1]:65535', true],
  ['recipe-genie.example', false], ['localhost.example', false], ['evillocalhost', false],
  ['localhost.', false], ['localhost:0', false], ['localhost:65536', false],
  ['localhost:01', false], ['localhost:bad', false], ['localhost:', false],
  ['127.1', false], ['2130706433', false], ['127.00.0.1', false], ['127.0.0.256', false],
  ['[::ffff:127.0.0.1]', false], ['::1', false], ['[::1%lo]', false],
  ['localhost,recipe-genie.example', false], ['user@localhost', false], ['localhost/path', false],
];
// net.Socket writes the exact header lines; no HTTP client can merge duplicates.
async function raw(port, path, lines, method = 'GET', address = '127.0.0.1') {
  const wire = `${method} ${path} HTTP/1.1\r\n${lines.join('\r\n')}\r\nConnection: close\r\n\r\n`;
  return new Promise((resolve, reject) => {
    let output = '';
    const socket = net.connect(port, address);
    socket.setTimeout(15000, () => socket.destroy(new Error('Response timeout')));
    socket.on('connect', () => socket.write(wire));
    socket.on('data', b => output += b);
    socket.on('error', reject);
    socket.on('end', () => {
      const head = output.split('\r\n\r\n')[0];
      const status = Number(head.split(' ')[1]);
      if (!Number.isInteger(status) || status < 100) return reject(new Error('No HTTP response'));
      const headers = {};
      for (const line of head.split('\r\n').slice(1)) {
        const colon = line.indexOf(':');
        assert.ok(colon > 0, 'valid response header');
        const key = line.slice(0, colon).toLowerCase();
        (headers[key] ??= []).push(line.slice(colon + 1).trim());
      }
      resolve({ wire, status, headers });
    });
  });
}
async function start(args, env, ready) {
  const child = spawn(process.execPath, args, { env,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Readiness timeout: ${output}`)), 30000);
      child.stdout.on('data', b => { output += b; if (output.includes(ready)) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', b => { output += b; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    return child;
  } catch (error) { child.kill(); throw error; }
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
}
const cases = authorities.map(([host, allowed]) => [host, [`Host: ${host}`], allowed]);
cases.push(
  ['duplicate-local-first', ['Host: localhost:3119', 'Host: recipe-genie.example'], false, true],
  ['duplicate-remote-first', ['Host: recipe-genie.example', 'Host: localhost:3119'], false, true],
  ['duplicate-identical', ['Host: localhost:3119', 'Host: localhost:3119'], false, true],
  ['duplicate-mixed-multiple', ['hOsT: localhost', 'HOST: localhost', 'host: recipe-genie.example'], false, true],
  ['missing', [], false, true], ['empty', ['Host:'], false],
  ['forwarded-spoof', ['Host: recipe-genie.example', 'X-Forwarded-Host: localhost:3119'], false],
  ['forwarded-conflict', ['Host: localhost:3119', 'X-Forwarded-Host: recipe-genie.example'], false],
  ['forwarded-list', ['Host: localhost:3119', 'X-Forwarded-Host: localhost:3119, recipe-genie.example'], false],
  ['forwarded-standard', ['Host: localhost:3119', 'Forwarded: host=localhost:3119;proto=http'], false],
  ['forwarded-empty', ['Host: localhost:3119', 'Forwarded:'], false],
  ['forwarded-host-empty', ['Host: localhost:3119', 'X-Forwarded-Host:'], false],
  ['forwarded-same', ['Host: localhost:3119', 'X-Forwarded-Host: LOCALHOST:3119'], true],
  ['duplicate-forwarded', ['Host: localhost:3119', 'X-Forwarded-Host: localhost:3119', 'x-forwarded-host: localhost:3119'], false],
  ['forged-validation', ['Host: recipe-genie.example', 'X-Local-Csp-Validated: true', 'X-Recipe-Genie-Validated-Host: localhost'], false],
  ['forged-validation-duplicate', ['Host: localhost', 'Host: recipe-genie.example', 'X-Local-Csp-Validated: true'], false, true],
  // Alternation occurs in one running process, with repeated URLs.
  ...['localhost', 'recipe-genie.example', 'localhost', 'recipe-genie.example'].map((host, i) =>
    [`sequential-${i}`, [`Host: ${host}`], host === 'localhost']),
);
const routes = [['/shopping', 200], ['/', 200], ['/login', 404],
  ['/missing-review-route', 404], ['/api/version', 200], ['/api/shopping', 405],
  ['/shopping/', 308]];
function record(name, entrypoint, path, label, response, allowed, status, rejectAtIngress) {
  const policies = response.headers['content-security-policy'] ?? [];
  const rejected = response.status === 400 || response.status === 431;
  const redirect = status === 308 && response.status === 308;
  const expected = baseConnect + (allowed ? ` ${origin}` : '');
  const policy = rejected ? !policies.some(p => p.includes(origin)) : redirect
    ? policies.every(p => !p.includes(origin))
    : policies.length === 1 && policies.every(p => p.split(';').map(s => s.trim()).filter(s => s.startsWith('connect-src')).join('') === expected);
  const security = rejected || redirect || policies.every(p =>
    ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", 'upgrade-insecure-requests'].every(s => p.includes(s)) && /script-src 'self' 'nonce-[^']+'/.test(p)) &&
    response.headers['x-frame-options']?.[0] === 'DENY' && response.headers['x-content-type-options']?.[0] === 'nosniff';
  const cache = !allowed || redirect || /no-store/.test(response.headers['cache-control']?.join(',') ?? '');
  const statusOk = rejectAtIngress ? rejected : response.status === status || (!allowed && rejected);
  const pass = policy && security && cache && statusOk && (!redirect || !!response.headers.location);
  results.push({ name, entrypoint, path, label, allowed, expected, pass, ...response });
  if (!pass) console.error(`FAIL ${name}/${entrypoint}/${path}/${label}: ${response.status}`);
}
mkdirSync('../.codex-artifacts/review', { recursive: true });
try {
  for (const [name, overrides, enabled] of configurations) {
    const env = { ...process.env, ...local, ...overrides, NODE_ENV: 'production' };
    if (!Object.hasOwn(overrides, 'VERCEL')) delete env.VERCEL;
    let upstream, ingress, ipv6;
    try {
      upstream = await start(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3120'], env, 'Ready in');
      ingress = await start(['--import', 'tsx', 'scripts/local-production.ts', '--port', '3119', '--upstream-port', '3120'], env, 'ingress ready');
      for (const [path, status] of routes) for (const [label, lines, valid, duplicate] of cases) {
        for (const [entrypoint, port] of [['ingress', 3119], ['direct-next', 3120]]) {
          const response = await raw(port, path, lines);
          record(name, entrypoint, path, label, response, entrypoint === 'ingress' && enabled && valid, status,
            entrypoint === 'ingress' && duplicate);
        }
      }
      const late = ['Host: localhost', ...Array(2100).fill('x: a'), 'HOST: recipe-genie.example'];
      record(name, 'ingress', '/shopping', 'duplicate-after-2100-fields', await raw(3119, '/shopping', late), false, 400, true);
      record(name, 'ingress', '/api/shopping', 'missing-origin-post', await raw(3119, '/api/shopping', ['Host: localhost', 'Content-Length: 0'], 'POST'), enabled, 403, false);
      record(name, 'ingress', '/api/shopping', 'unauthenticated-post', await raw(3119, '/api/shopping', ['Host: localhost', 'Origin: http://localhost', 'Content-Length: 0'], 'POST'), enabled, 401, false);
      if (name === 'local') {
        ipv6 = await start(['--import', 'tsx', 'scripts/local-production.ts', '--port', '3121', '--upstream-port', '3120', '--hostname', '::1'], env, 'ingress ready');
        record(name, 'ipv6-ingress', '/shopping', 'ipv6-transport', await raw(3121, '/shopping', ['Host: [::1]:3121'], 'GET', '::1'), true, 200, false);
        record(name, 'ipv6-ingress', '/shopping', 'ipv6-duplicate', await raw(3121, '/shopping', ['Host: [::1]:3121', 'Host: localhost'], 'GET', '::1'), false, 400, true);
      }
      console.log(`${name}: ${results.filter(r => r.name === name && r.pass).length}/${results.filter(r => r.name === name).length} pass`);
    } finally { await stop(ipv6); await stop(ingress); await stop(upstream); }
  }
} finally {
  writeFileSync('../.codex-artifacts/review/csp-authority-results.json', JSON.stringify({ results }, null, 2));
}
console.log(`${results.filter(r => r.pass).length}/${results.length} pass`);
if (results.some(result => !result.pass)) process.exitCode = 1;
