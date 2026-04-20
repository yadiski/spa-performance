import { createHash } from 'node:crypto';

export const MIN_LENGTH = 12;

export type PasswordCheckResult =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'breached'; message: string };

async function sha1Hex(password: string): Promise<string> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return hash;
}

async function checkHibp(password: string): Promise<boolean> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true' },
    });

    if (!res.ok) {
      console.warn('password-policy: HIBP returned non-200', res.status);
      return false; // fail-open on API errors
    }

    const body = await res.text();
    const lines = body.split('\n');
    for (const line of lines) {
      const [lineSuffix] = line.split(':');
      if (lineSuffix?.trim().toUpperCase() === suffix) {
        return true; // found in breached list
      }
    }
    return false;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      console.warn('password-policy: HIBP request timed out, failing open');
    } else {
      console.warn('password-policy: HIBP request failed, failing open', e);
    }
    return false; // fail-open on network errors
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkPassword(password: string): Promise<PasswordCheckResult> {
  if (password.length < MIN_LENGTH) {
    return {
      ok: false,
      reason: 'too_short',
      message: `Password must be at least ${MIN_LENGTH} characters`,
    };
  }

  const breached = await checkHibp(password);
  if (breached) {
    return {
      ok: false,
      reason: 'breached',
      message: 'This password has appeared in a data breach. Please choose a different password.',
    };
  }

  return { ok: true };
}
