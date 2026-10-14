import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  authHeaders: Record<string, string>;
  sessionId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Returns the auth headers for the currently executing MCP request.
 * Returns an empty object when called outside of an HTTP request context (e.g., stdio mode).
 */
export function getRequestAuthHeaders(): Record<string, string> {
  return requestContext.getStore()?.authHeaders ?? {};
}

/**
 * Returns the MCP session ID of the currently executing HTTP request, or undefined outside
 * one (stdio mode). Its presence is how code tells "remote server" from "local client".
 */
export function getRequestSessionId(): string | undefined {
  return requestContext.getStore()?.sessionId;
}
