import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export type ApiError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  requestId: string | undefined;
};

export function onError(err: unknown, c: Context): Response {
  const requestId = c.get('requestId') as string | undefined;
  if (err instanceof HTTPException) {
    return c.json<ApiError>(
      { code: err.status === 401 ? 'unauthorized' : 'http_error', message: err.message, requestId },
      err.status,
    );
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.')] = issue.message;
    return c.json<ApiError>(
      { code: 'validation_error', message: 'Validation failed', fields, requestId },
      400,
    );
  }
  console.error('unhandled error', err);
  return c.json<ApiError>(
    { code: 'internal_error', message: 'Internal server error', requestId },
    500,
  );
}
