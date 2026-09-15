/** Explicit local production-build verification; never a hosted CSP allowance. */
export function localCspConnectionOrigin(input: {
  requestUrl: string;
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
    if (!loopback(app) || !loopback(backend) || !backend.port ||
        backend.origin !== input.allowedOrigin) return null;
    return backend.origin;
  } catch {
    return null;
  }
}
