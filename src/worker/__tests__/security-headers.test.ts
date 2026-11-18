/** @jest-environment node */

import { Hono } from 'hono';
import { SECURITY_HEADERS, securityHeadersFile } from '../../shared/security-headers';
import { installRequestPolicy } from '../request-policy';
import type { Env } from '../types';

/** Parse a `_headers` file into { pathPattern: { header: value } }. */
function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      current = rules[line.trim()] = {};
      continue;
    }
    const colon = line.indexOf(':');
    current![line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return rules;
}

describe('security headers', () => {
  it('the _headers file applies the full policy to every asset path', () => {
    expect(parseHeadersFile(securityHeadersFile())).toEqual({ '/*': { ...SECURITY_HEADERS } });
  });

  it('the worker applies the same policy', async () => {
    const app = new Hono<{ Bindings: Env }>();
    installRequestPolicy(app);
    app.get('/ok', (c) => c.text('ok'));
    const res = await app.request('/ok', {}, {} as Env);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });
});
