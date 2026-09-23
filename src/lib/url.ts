/* Compose an absolute URL from an origin and a path-only value (the form
   third-party *_REDIRECT_URI overrides are stored in). Absolute http(s) URLs
   pass through unchanged so legacy configs keep working; anything else is
   treated as a path and joined onto the origin (PUBLIC_ORIGIN or the request
   origin, resolved by the caller). */
export function joinOriginPath(origin: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${origin}${path}`;
}
