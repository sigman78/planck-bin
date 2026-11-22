/** @jest-environment node */

import { BOOT_SCRIPT_HASH, SECURITY_HEADERS } from '../../shared/security-headers';

// Jest runs this under node; the worker tsconfig has no node types, so declare what is used.
declare const require: (id: string) => {
  readFileSync(path: string, enc: string): string;
  createHash(alg: string): { update(data: string): { digest(enc: string): string } };
};
declare const __dirname: string;

const SHELL = require('node:fs').readFileSync(`${__dirname}/../../client/index.html`, 'utf8');
const { createHash } = require('node:crypto');

/** Inline (no src) classic scripts in the shell, exactly as the browser hashes them. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

describe('inline boot script', () => {
  it('is the only inline script, and the CSP allows exactly it', () => {
    const scripts = inlineScripts(SHELL);
    expect(scripts).toHaveLength(1);
    const hash = `sha256-${createHash('sha256').update(scripts[0]).digest('base64')}`;
    expect(hash).toBe(BOOT_SCRIPT_HASH);
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain(
      `script-src 'self' '${BOOT_SCRIPT_HASH}';`
    );
  });
});
