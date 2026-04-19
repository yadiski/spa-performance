export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: unknown): string => {
    if (v === null) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stringify).join(',')}]`;
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('cycle');
      seen.add(v);
      const keys = Object.keys(v as object).sort();
      const parts = keys.map(
        (k) => `${JSON.stringify(k)}:${stringify((v as Record<string, unknown>)[k])}`,
      );
      return `{${parts.join(',')}}`;
    }
    return 'null';
  };
  return stringify(value);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer so the BufferSource type matches (works around
  // TS lib.dom's exact ArrayBuffer constraint vs Uint8Array<ArrayBufferLike>).
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return new Uint8Array(digest);
}

export function concatBytes(...parts: (Uint8Array | string)[]): Uint8Array {
  const bufs = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : p));
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
