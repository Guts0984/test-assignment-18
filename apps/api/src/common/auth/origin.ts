const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery check for cookie authentication. Browsers send `Origin` with every
 * cross-origin write, so a foreign one is refused; so is a request the browser marks cross-site.
 */
export const isForgedRequest = (
  request: {
    readonly method: string;
    readonly origin: string | undefined;
    readonly fetchSite: string | undefined;
  },
  allowedOrigins: readonly string[],
): boolean => {
  if (SAFE_METHODS.has(request.method)) return false;
  if (request.origin !== undefined) return !allowedOrigins.includes(request.origin);
  return request.fetchSite === 'cross-site';
};
