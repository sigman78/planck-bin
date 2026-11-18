/**
 * The one HTTP security-header policy for every response.
 *
 * Two places apply it:
 * - the worker (src/worker/request-policy.ts), for every response it produces;
 * - a `_headers` file the build writes from this module (vite.config.ts), for
 *   files the assets layer serves without running the worker, such as `/`
 *   (index.html), robots.txt and the hashed bundles.
 */

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
    "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

/** The policy as a Cloudflare static-assets `_headers` file, applied to every path. */
export function securityHeadersFile(): string {
  const lines = Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`);
  return ['/*', ...lines, ''].join('\n');
}
