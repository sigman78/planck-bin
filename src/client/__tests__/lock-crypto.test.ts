/** @jest-environment node */

import {
  generatePassphrase,
  isWeakerThanSuggestion,
  loadWordlist,
  lockContent,
  normalizePassphrase,
  openLock,
} from '../lock-crypto';
import { LOCK_SALT_PATTERN, LOCK_TOKEN_PATTERN } from '../../shared/types';
import { fromBase64Url, toBase64Url } from '../../shared/base64url';

describe('normalizePassphrase', () => {
  it('ignores case, and spaces, dots, dashes and underscores between words', () => {
    const canonical = 'maple-orbit-quiet-lantern';
    for (const typed of [
      'maple-orbit-quiet-lantern',
      'Maple Orbit Quiet Lantern',
      '  maple.orbit_quiet  -- lantern ',
      'MAPLE\torbit\nquiet lantern',
    ]) {
      expect(normalizePassphrase(typed)).toBe(canonical);
    }
  });

  it('folds Unicode compatibility forms', () => {
    expect(normalizePassphrase('ＡＢc')).toBe('abc'); // fullwidth A, B
  });

  it('is empty for separators only', () => {
    expect(normalizePassphrase(' - . _ ')).toBe('');
  });
});

describe('generatePassphrase', () => {
  it('draws four words from the EFF list', async () => {
    const words = await loadWordlist();
    expect(words).toHaveLength(7776);
    expect(new Set(words).size).toBe(7776);

    const phrase = generatePassphrase(words);
    // Hyphenated list words (t-shirt) can add pieces, never remove them.
    expect(phrase.split('-').length).toBeGreaterThanOrEqual(4);
    expect(normalizePassphrase(phrase)).toBe(phrase);
  });

  it('uses every word of a small list', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generatePassphrase(['a', 'b', 'c'], 1));
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('isWeakerThanSuggestion', () => {
  const suggestion = 'maple-orbit-quiet-lantern';

  it('is quiet for the suggestion itself, in any spelling, and for an empty field', () => {
    expect(isWeakerThanSuggestion(suggestion, suggestion)).toBe(false);
    expect(isWeakerThanSuggestion('Maple Orbit Quiet Lantern', suggestion)).toBe(false);
    expect(isWeakerThanSuggestion('', suggestion)).toBe(false);
  });

  it('flags edits under three words or 16 characters', () => {
    expect(isWeakerThanSuggestion('maple-orbit', suggestion)).toBe(true);
    expect(isWeakerThanSuggestion('averyveryverylongword', suggestion)).toBe(true);
    expect(isWeakerThanSuggestion('a-b-c', suggestion)).toBe(true);
  });

  it('accepts edits that keep three words and 16 characters', () => {
    expect(isWeakerThanSuggestion('maple orbit quiet', suggestion)).toBe(false);
    expect(isWeakerThanSuggestion('open sesame please', suggestion)).toBe(false);
  });
});

describe('base64url', () => {
  it('round-trips bytes, including large buffers', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65536)).map((b, i) => (i % 3 ? b : 255));
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('rejects other alphabets', () => {
    expect(() => fromBase64Url('ab+/')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});

describe('lockContent / openLock', () => {
  const TEXT = 'fn main() {\n  println!("café");\n}\n';

  it('round-trips under the same passphrase in any spelling', async () => {
    const { envelope, lock } = await lockContent(TEXT, 'Correct Horse Battery');
    expect(lock.salt).toMatch(LOCK_SALT_PATTERN);
    expect(lock.token).toMatch(LOCK_TOKEN_PATTERN);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain('main');

    const opened = await openLock('correct-horse-battery', lock.salt);
    expect(opened.token).toBe(lock.token);
    expect(await opened.decrypt(envelope)).toBe(TEXT);
  });

  it('gives a wrong passphrase another token and no plaintext', async () => {
    const { envelope, lock } = await lockContent(TEXT, 'correct-horse-battery');
    const wrong = await openLock('correct-horse-batterz', lock.salt);
    expect(wrong.token).not.toBe(lock.token);
    await expect(wrong.decrypt(envelope)).rejects.toThrow();
  });

  it('salts every paste afresh', async () => {
    const a = await lockContent(TEXT, 'same passphrase');
    const b = await lockContent(TEXT, 'same passphrase');
    expect(a.lock.salt).not.toBe(b.lock.salt);
    expect(a.lock.token).not.toBe(b.lock.token);
    expect(a.envelope).not.toBe(b.envelope);
  });

  it('detects tampering', async () => {
    const { envelope, lock } = await lockContent(TEXT, 'correct-horse-battery');
    const opened = await openLock('correct-horse-battery', lock.salt);
    const flipped = envelope.slice(0, -2) + (envelope.at(-2) === 'A' ? 'B' : 'A') + envelope.at(-1);
    await expect(opened.decrypt(flipped)).rejects.toThrow();
    await expect(opened.decrypt('v2.' + envelope.slice(3))).rejects.toThrow(/format/);
  });
});
