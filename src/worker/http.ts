/**
 * Small HTTP helpers shared by the request policy and the routes.
 */

/** The media type of a Content-Type header, lowercased and without parameters. */
export function mediaType(contentType: string | undefined | null): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export function isJsonContentType(contentType: string | undefined | null): boolean {
  return mediaType(contentType) === 'application/json';
}

/** Whether an If-None-Match header matches the given entity tag (weak comparison). */
export function etagMatches(ifNoneMatch: string | undefined | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  const target = bare(etag);
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || bare(tag) === target);
}
