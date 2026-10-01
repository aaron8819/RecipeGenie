// Optional local verification ingress. The upstream is an ordinary next start
// server with an always-restrictive production CSP, even when reached directly.
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { localCspConnectionOrigin, rawHeaderValues } from '../src/lib/local-csp';

config({ path: '.env.local' });
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3117' },
  'upstream-port': { type: 'string', default: '3118' },
  hostname: { type: 'string', default: '127.0.0.1' },
} });
function port(value: string) {
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error('Expected a port from 1 to 65535');
  }
  return Number(value);
}
const listenPort = port(values.port!);
const upstreamPort = port(values['upstream-port']!);
const hostname = values.hostname!;
if (!['127.0.0.1', '::1'].includes(hostname) || listenPort === upstreamPort) {
  throw new Error('Use a loopback listener and a separate upstream port');
}
const appOrigin = `http://${hostname === '::1' ? '[::1]' : hostname}:${listenPort}`;
const restrictiveConnect = "connect-src 'self' https://*.supabase.co wss://*.supabase.co";

function endToEndHeaders(headers: IncomingHttpHeaders) {
  const copy = { ...headers };
  const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
    ...(headers.connection ?? '').toLowerCase().split(',').map(s => s.trim())];
  for (const name of hopHeaders) delete copy[name];
  return copy;
}

const server = createServer((incoming, outgoing) => {
  const fail = (status: number) => {
    outgoing.writeHead(status, { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    outgoing.end();
  };
  // Reject duplicates (including identical ones) before any normalization.
  // Only origin-form targets are supported; this is not a forward proxy.
  if (rawHeaderValues(incoming.rawHeaders, 'host').length !== 1 ||
      !incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
    fail(400);
    return;
  }
  const origin = localCspConnectionOrigin({
    rawHeaders: incoming.rawHeaders,
    requestUrl: appOrigin,
    target: process.env.RECIPE_GENIE_E2E_TARGET,
    allowedOrigin: process.env.RECIPE_GENIE_LOCAL_CSP_ORIGIN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    vercel: process.env.VERCEL,
  });
  const upstream = request({ hostname: '127.0.0.1', port: upstreamPort,
    method: incoming.method, path: incoming.url,
    headers: endToEndHeaders(incoming.headers),
  }, response => {
    const headers = endToEndHeaders(response.headers);
    const csp = headers['content-security-policy'];
    // Amend only the known restrictive directive; preserve all other directives,
    // nonce values, cookies, status codes, redirects and response bodies.
    if (origin && typeof csp === 'string') {
      headers['content-security-policy'] = csp.split(';').map(directive =>
        directive.trim() === restrictiveConnect ? `${directive} ${origin}` : directive
      ).join(';');
    }
    headers['cache-control'] = 'private, no-store';
    outgoing.writeHead(response.statusCode!, headers);
    response.on('error', () => outgoing.destroy());
    response.pipe(outgoing);
  });
  upstream.on('error', () => {
    if (!outgoing.headersSent) fail(502);
    else outgoing.destroy();
  });
  incoming.on('aborted', () => upstream.destroy());
  outgoing.on('close', () => upstream.destroy());
  incoming.pipe(upstream);
});
// Disable count truncation: even a late duplicate must remain in rawHeaders.
// Node's bounded maxHeaderSize and strict HTTP parser still apply.
server.maxHeadersCount = 0;
server.listen(listenPort, hostname, () => console.log(`Local verification ingress ready: ${appOrigin}`));
function stop() {
  server.close();
  server.closeAllConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
