/**
 * Paste - Document
 *
 */

/**
 * Burn after reading: 'armed' is the creator's just-saved paste (the first
 * read will destroy it), 'pending' an unread one behind the reveal gate (no
 * content loaded), 'burned' a revealed one (already gone on the server).
 */
export type BurnState = 'armed' | 'pending' | 'burned';

export class Paste {
  content: string = '';
  key?: string;
  language?: string;
  frozen: boolean = false;
  burn?: BurnState;
  /** Protected paste: encrypted on the server, shown here decrypted (or behind the lock gate). */
  locked: boolean = false;

  get isLoaded(): boolean {
    return this.key !== undefined;
  }

  reset(): void {
    this.content = '';
    this.key = undefined;
    this.language = undefined;
    this.frozen = false;
    this.burn = undefined;
    this.locked = false;
  }

  apply(data: {
    content: string;
    key?: string;
    language?: string;
    frozen?: boolean;
    burn?: BurnState;
    locked?: boolean;
  }): void {
    this.content = data.content;
    this.key = data.key;
    this.language = data.language;
    this.frozen = data.frozen ?? false;
    this.burn = data.burn;
    this.locked = data.locked ?? false;
  }
}
