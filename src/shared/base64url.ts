/**
 * Base64url without padding (RFC 4648 section 5), for keys, salts and
 * ciphertext. Works in the browser and the worker (btoa/atob only).
 */

const CHUNK = 0x8000;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: String.fromCharCode with a huge spread overflows the call stack.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** @throws Error when the input is not base64url */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('Invalid base64url');
  }
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
