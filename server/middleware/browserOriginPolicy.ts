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
  secondaryOrigin?: string,
): { allowed: boolean; responseOrigin: string | undefined } {
  if (!hosted) return { allowed: true, responseOrigin: '*' };
  if (!appOrigin || appOrigin === '*') return { allowed: false, responseOrigin: undefined };
  const matched = origin && (origin === appOrigin || origin === secondaryOrigin) ? origin : undefined;
  if (origin && !matched) return { allowed: false, responseOrigin: undefined };
  return { allowed: true, responseOrigin: matched };
}
