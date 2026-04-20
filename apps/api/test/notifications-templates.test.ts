process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { NotificationKind } from '@spa/shared';
import { renderEmail } from '../src/domain/notifications/templates';

const ALL_KINDS = Object.values(NotificationKind);

describe('renderEmail — templates', () => {
  it('every NotificationKind produces non-empty subject, text, and html', () => {
    for (const kind of ALL_KINDS) {
      const result = renderEmail(kind, {});
      expect(result.subject.length, `${kind} subject empty`).toBeGreaterThan(0);
      expect(result.text.length, `${kind} text empty`).toBeGreaterThan(0);
      expect(result.html.length, `${kind} html empty`).toBeGreaterThan(0);
    }
  });

  it('staffName appears in output when provided; fallback text appears when missing', () => {
    const kindsThatUseStaffName = [
      NotificationKind.PmsSelfReviewSubmitted,
      NotificationKind.MidYearSubmitted,
      NotificationKind.PmsAppraiserSubmitted,
      NotificationKind.PmsReturnedToAppraiser,
      NotificationKind.PmsNextLevelSubmitted,
    ];

    for (const kind of kindsThatUseStaffName) {
      const withName = renderEmail(kind, { staffName: 'Alice Smith' });
      expect(withName.text, `${kind}: staffName not in text`).toContain('Alice Smith');
      expect(withName.html, `${kind}: staffName not in html`).toContain('Alice Smith');

      const withoutName = renderEmail(kind, {});
      expect(withoutName.text, `${kind}: fallback not in text`).toContain('Staff member');
      expect(withoutName.html, `${kind}: fallback not in html`).toContain('Staff member');
    }
  });

  it('does not throw when all context fields are missing', () => {
    for (const kind of ALL_KINDS) {
      expect(() => renderEmail(kind, {})).not.toThrow();
    }
  });

  it('when ctx.link is provided, html contains the href', () => {
    for (const kind of ALL_KINDS) {
      const result = renderEmail(kind, { link: 'https://example.com/review/123' });
      expect(result.html, `${kind}: link not in html`).toContain(
        'href="https://example.com/review/123"',
      );
      expect(result.text, `${kind}: link not in text`).toContain('https://example.com/review/123');
    }
  });

  it('when ctx.link is absent, html does not contain href=""', () => {
    for (const kind of ALL_KINDS) {
      const result = renderEmail(kind, {});
      expect(result.html, `${kind}: malformed href="" found`).not.toContain('href=""');
    }
  });

  it('output is deterministic: calling renderEmail twice returns identical strings', () => {
    const ctx = {
      staffName: 'Bob Jones',
      appraisalPeriod: '2025',
      link: 'https://app.example.com',
    };
    for (const kind of ALL_KINDS) {
      const first = renderEmail(kind, ctx);
      const second = renderEmail(kind, ctx);
      expect(first.subject, `${kind}: subject not deterministic`).toBe(second.subject);
      expect(first.text, `${kind}: text not deterministic`).toBe(second.text);
      expect(first.html, `${kind}: html not deterministic`).toBe(second.html);
    }
  });
});
