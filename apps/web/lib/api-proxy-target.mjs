/**
 * Default Nest API origin for server-side fetches and Next rewrites.
 * Must match services/api PORT default (4000). Production overrides via
 * API_PROXY_TARGET (deploy handbook: http://127.0.0.1:4100).
 */
export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:4000";

/** Resolve Nest origin used by rewrites / SSR / middleware. */
export function resolveApiProxyTarget(env = process.env) {
  return (env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET).replace(/\/$/, "");
}
