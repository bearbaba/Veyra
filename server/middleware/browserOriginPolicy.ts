/**
 * Hosted browser requests must come from the explicitly configured application
 * origin. CORS response headers alone are not an authorization boundary:
 * the server must reject a mismatched Origin before hitting a route.
 *
 * Requests without Origin are permitted here for server-to-server clients;
 * those routes must still independently authenticate/authorize the caller.
 */
export function evaluateBrowserOrigin(
  origin: string | undefined,
  appOrigin: string | undefined,
  hosted: boolean,
): { allowed: boolean; responseOrigin: string | undefined } {
  if (!hosted) return { allowed: true, responseOrigin: '*' };
  if (!appOrigin || appOrigin === '*') return { allowed: false, responseOrigin: undefined };
  if (origin && origin !== appOrigin) return { allowed: false, responseOrigin: undefined };
  return { allowed: true, responseOrigin: origin === appOrigin ? appOrigin : undefined };
}
