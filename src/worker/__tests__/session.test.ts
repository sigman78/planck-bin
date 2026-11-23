/** @jest-environment node */

import { seal, uidOf, unseal } from '../session';
import { toBase64Url } from '../../shared/base64url';

const SECRET = 'test-session-secret-0123456789abcdef';
const now = Math.floor(Date.now() / 1000);

describe('sealed values', () => {
  it('round-trips a payload for its purpose', async () => {
    const value = await seal('session', { uid: 'u1', exp: now + 60 }, SECRET);
    expect(await unseal('session', value, SECRET)).toEqual({ uid: 'u1', exp: now + 60 });
  });

  it('rejects a tampered payload or signature', async () => {
    const value = await seal('session', { uid: 'u1', exp: now + 60 }, SECRET);
    const [body, mac] = value.split('.');
    const forged = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ uid: 'admin', exp: now + 60 }))
    );
    expect(await unseal('session', `${forged}.${mac}`, SECRET)).toBeNull();
    expect(await unseal('session', `${body}.${mac.slice(0, -2)}AA`, SECRET)).toBeNull();
    expect(await unseal('session', `${body}`, SECRET)).toBeNull();
    expect(await unseal('session', 'garbage.$$$', SECRET)).toBeNull();
  });

  it('never passes a sign-in transaction off as a session', async () => {
    const tx = await seal('tx', { uid: 'u1', exp: now + 60 }, SECRET);
    expect(await unseal('session', tx, SECRET)).toBeNull();
  });

  it('rejects another secret and expired values', async () => {
    const value = await seal('session', { exp: now + 60 }, SECRET);
    expect(await unseal('session', value, `${SECRET}-rotated`)).toBeNull();
    const old = await seal('session', { exp: now - 1 }, SECRET);
    expect(await unseal('session', old, SECRET)).toBeNull();
  });
});

describe('uidOf', () => {
  it('is stable per issuer and subject, and opaque', async () => {
    const a = await uidOf('https://id.example', 'user-1');
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await uidOf('https://id.example', 'user-1')).toBe(a);
    expect(await uidOf('https://other.example', 'user-1')).not.toBe(a);
    // The separator keeps "ab"+"c" and "a"+"bc" apart.
    expect(await uidOf('ab', 'c')).not.toBe(await uidOf('a', 'bc'));
  });
});
