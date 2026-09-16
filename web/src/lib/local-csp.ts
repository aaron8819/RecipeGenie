/** Only for the local verification ingress, before HTTP header normalization. */
export function localCspConnectionOrigin(input: {
  requestUrl: string;
  rawHeaders: readonly string[];
  target?: string;
  allowedOrigin?: string;
  supabaseUrl?: string;
  vercel?: string;
}): string | null {
  const hosts = rawHeaderValues(input.rawHeaders, 'host');
  const forwardedHosts = rawHeaderValues(input.rawHeaders, 'x-forwarded-host');
  const forwarded = rawHeaderValues(input.rawHeaders, 'forwarded');
  if (hosts.length !== 1 || forwarded.length !== 0 ||
      forwardedHosts.length > 1) return null;
  const host = hosts[0];
  if (input.vercel !== undefined || input.target !== 'local' ||
      !input.allowedOrigin || input.allowedOrigin !== input.supabaseUrl) return null;
  try {
    const app = new URL(input.requestUrl);
    const backend = new URL(input.allowedOrigin);
    const loopback = (url: URL) => url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username && !url.password;
    // No trusted forwarding or client-supplied validation marker.
    if (!isLoopbackAuthority(host) ||
        (forwardedHosts.length === 1 && forwardedHosts[0].toLowerCase() !== host.toLowerCase()) ||
        !loopback(app) || !loopback(backend) || !backend.port ||
        backend.origin !== input.allowedOrigin) return null;
    return backend.origin;
  } catch {
    return null;
  }
}

export function rawHeaderValues(headers: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < headers.length; i += 2) {
    if (headers[i].toLowerCase() === name) values.push(headers[i + 1]);
  }
  return values;
}

/** Strict DNS localhost, dotted-decimal 127/8, or bracketed IPv6 loopback. */
export function isLoopbackAuthority(authority?: string | null): boolean {
  if (!authority || authority !== authority.trim()) return false;
  const match = /^(localhost|127\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})|\[[0-9a-f:]+\])(?::([1-9]\d{0,4}))?$/i.exec(authority);
  if (!match || (match[2] && Number(match[2]) > 65535)) return false;
  const host = match[1].toLowerCase();
  if (host === 'localhost') return true;
  if (host.startsWith('127.')) return host.split('.').every(o => Number(o) <= 255);
  try { return new URL(`http://${host}`).hostname === '[::1]'; }
  catch { return false; }
}
