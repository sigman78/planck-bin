/**
 * AuthClient - the optional sign-in, as the client sees it.
 *
 * The session itself is an HttpOnly cookie the page cannot read; pb_in is a
 * readable hint that one may exist, so a signed-out page never asks the
 * server at startup. Without the hint the state stays unknown until the
 * palette first opens (refresh then).
 */

import type { AuthFlash, AuthState } from '../shared/types';

const HINT_COOKIE = 'pb_in';
const FLASH_COOKIE = 'pb_flash';

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const at = part.indexOf('=');
    if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

const FLASHES: Record<AuthFlash, true> = { 'signin-failed': true, denied: true, unavailable: true };

export class AuthClient {
  /** null until known (see refresh). */
  state: AuthState | null = null;
  private pending: Promise<AuthState | null> | null = null;

  /** A session cookie may exist: worth asking at startup. */
  hasHint(): boolean {
    return readCookie(HINT_COOKIE) === '1';
  }

  get userName(): string | undefined {
    return this.state?.user?.name;
  }

  get signedIn(): boolean {
    return this.state?.user != null;
  }

  /**
   * Ask the server. A 404 (a worker without sign-in routes) means off; a
   * network or server error keeps the last known state (null at first), so
   * the next palette open asks again instead of hiding Sign in until reload.
   */
  refresh(): Promise<AuthState | null> {
    this.pending ??= (async () => {
      try {
        const response = await fetch('/auth/me', { cache: 'no-store' });
        if (response.ok) this.state = (await response.json()) as AuthState;
        else if (response.status === 404) this.state = { enabled: false, user: null };
      } catch {
        // offline: unknown, try again later
      } finally {
        this.pending = null;
      }
      return this.state;
    })();
    return this.pending;
  }

  /** Leave for the identity provider; it comes back to `returnPath`. */
  signIn(returnPath: string): void {
    window.location.assign(`/auth/login?return=${encodeURIComponent(returnPath)}`);
  }

  /** @throws Error when the server could not be reached */
  async signOut(): Promise<void> {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error(`Sign-out failed: ${response.status}`);
    if (this.state) this.state = { ...this.state, user: null };
  }

  /** The outcome the sign-in callback left to report, once. */
  takeFlash(): AuthFlash | null {
    const value = readCookie(FLASH_COOKIE);
    if (value === null) return null;
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; Path=/`;
    return value in FLASHES ? (value as AuthFlash) : null;
  }
}

export const FLASH_MESSAGES: Record<AuthFlash, string> = {
  'signin-failed': 'Sign-in failed. Please try again.',
  denied: 'This account may not sign in here.',
  unavailable: 'The sign-in service is not reachable. Try again later.',
};
