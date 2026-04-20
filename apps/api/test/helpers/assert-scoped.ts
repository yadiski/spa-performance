import { expect } from 'bun:test';
import type { Hono } from 'hono';

export interface ScopingCase {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** Cookie string for the authenticated but UNAUTHORIZED actor (e.g., a stranger staff member). */
  outsiderCookie: string;
  /** Expected status when the outsider calls the route. Usually 403; 404 for "hide existence". */
  expectedStatus: number;
}

export async function assertScoped(app: Hono, cases: ScopingCase[]): Promise<void> {
  for (const c of cases) {
    const init: RequestInit = {
      method: c.method,
      headers: { cookie: c.outsiderCookie, 'content-type': 'application/json' },
      ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    };
    const res = await app.request(c.path, init);
    expect(res.status, `${c.method} ${c.path} must reject outsider`).toBe(c.expectedStatus);
  }
}

/** Build ScopingCases that expect 401 for unauthenticated requests. */
export interface UnauthCase {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

export async function assertUnauthenticated(app: Hono, cases: UnauthCase[]): Promise<void> {
  for (const c of cases) {
    const init: RequestInit = {
      method: c.method,
      headers: { 'content-type': 'application/json' },
      ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    };
    const res = await app.request(c.path, init);
    expect(res.status, `${c.method} ${c.path} must reject unauthenticated (expected 401)`).toBe(
      401,
    );
  }
}
