/** Explicit local production-build verification; never a hosted CSP allowance. */
export function localCspConnectionOrigin(input: {
  requestUrl: string;
  host?: string | null;
  forwardedHost?: string | null;
  forwarded?: string | null;
  target?: string;
  allowedOrigin?: string;
  supabaseUrl?: string;
  vercel?: string;
}): string | null {
  if (input.vercel !== undefined || input.target !== 'local' ||
      !input.allowedOrigin || input.allowedOrigin !== input.supabaseUrl) return null;
  try {
    const app = new URL(input.requestUrl);
    const backend = new URL(input.allowedOrigin);
    const loopback = (url: URL) => url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username && !url.password;
    // Host is the incoming authority; Next's URL can contain the listener host.
    // There is no trusted proxy configuration. Forwarded cannot grant access.
    if (!isLoopbackAuthority(input.host) || input.forwarded != null ||
        (input.forwardedHost != null && input.forwardedHost.toLowerCase() !== input.host?.toLowerCase()) ||
        !loopback(app) || !loopback(backend) || !backend.port ||
        backend.origin !== input.allowedOrigin) return null;
    return backend.origin;
  } catch {
    return null;
  }
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
