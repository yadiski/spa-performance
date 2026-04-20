import { NotificationKind } from '@spa/shared';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface TemplateContext {
  [key: string]: unknown;
}

function baseHtml(body: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;color:#222;max-width:600px;margin:0 auto;padding:24px">${body}</body></html>`;
}

function linkLine(ctx: TemplateContext): { text: string; html: string } {
  if (typeof ctx.link === 'string') {
    return {
      text: `\n\nView here: ${ctx.link}`,
      html: `<p><a href="${ctx.link}" style="color:#4f46e5">View in the system</a></p>`,
    };
  }
  return { text: '', html: '' };
}

export function renderEmail(kind: NotificationKind, ctx: TemplateContext): RenderedEmail {
  const staffName = typeof ctx.staffName === 'string' ? ctx.staffName : 'Staff member';
  const appraisalPeriod =
    typeof ctx.appraisalPeriod === 'string' ? ctx.appraisalPeriod : 'the current period';
  const link = linkLine(ctx);

  switch (kind) {
    case NotificationKind.PmsSelfReviewSubmitted: {
      const subject = 'Staff has submitted their self-review';
      const text = `${staffName} has submitted their self-review for ${appraisalPeriod}. Please log in to review and rate their submission.${link.text}`;
      const html = baseHtml(
        `<p><strong>${staffName}</strong> has submitted their self-review for <strong>${appraisalPeriod}</strong>.</p><p>Please log in to review and rate their submission.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsReturnedToAppraisee: {
      const subject = 'Your self-review has been returned for revision';
      const returnNote = typeof ctx.returnNote === 'string' ? ctx.returnNote : '';
      const noteBlock = returnNote ? `\n\nNote from appraiser: ${returnNote}` : '';
      const noteHtml = returnNote
        ? `<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 12px;color:#555">${returnNote}</blockquote>`
        : '';
      const text = `Your self-review for ${appraisalPeriod} has been returned to you for revision.${noteBlock}${link.text}`;
      const html = baseHtml(
        `<p>Your self-review for <strong>${appraisalPeriod}</strong> has been returned to you for revision.</p>${noteHtml}${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsFinalized: {
      const subject = 'Your performance review has been finalized';
      const text = `Your performance review for ${appraisalPeriod} has been finalized. You may now view the final assessment.${link.text}`;
      const html = baseHtml(
        `<p>Your performance review for <strong>${appraisalPeriod}</strong> has been finalized.</p><p>You may now view the final assessment.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsPdfReady: {
      const subject = 'Your performance review PDF is ready';
      const text = `The PDF for your performance review (${appraisalPeriod}) is ready for download.${link.text}`;
      const html = baseHtml(
        `<p>The PDF for your performance review (<strong>${appraisalPeriod}</strong>) is ready for download.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.MidYearOpened: {
      const subject = 'Mid-year check-in is now open';
      const text = `The mid-year check-in window for ${appraisalPeriod} is now open. Please log in to submit your update.${link.text}`;
      const html = baseHtml(
        `<p>The mid-year check-in window for <strong>${appraisalPeriod}</strong> is now open.</p><p>Please log in to submit your update.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.MidYearSubmitted: {
      const subject = 'Staff has submitted their mid-year update';
      const text = `${staffName} has submitted their mid-year update for ${appraisalPeriod}. Please log in to review and acknowledge.${link.text}`;
      const html = baseHtml(
        `<p><strong>${staffName}</strong> has submitted their mid-year update for <strong>${appraisalPeriod}</strong>.</p><p>Please log in to review and acknowledge.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.MidYearAcked: {
      const subject = 'Your mid-year update has been acknowledged';
      const text = `Your mid-year update for ${appraisalPeriod} has been acknowledged by your appraiser.${link.text}`;
      const html = baseHtml(
        `<p>Your mid-year update for <strong>${appraisalPeriod}</strong> has been acknowledged by your appraiser.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsAppraiserSubmitted: {
      const subject = 'Appraiser has submitted their ratings';
      const text = `The appraiser ratings for ${staffName} (${appraisalPeriod}) have been submitted for next-level review.${link.text}`;
      const html = baseHtml(
        `<p>The appraiser ratings for <strong>${staffName}</strong> (<strong>${appraisalPeriod}</strong>) have been submitted for next-level review.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsReturnedToAppraiser: {
      const subject = 'Appraisal returned to appraiser for revision';
      const returnNote = typeof ctx.returnNote === 'string' ? ctx.returnNote : '';
      const noteBlock = returnNote ? `\n\nNote: ${returnNote}` : '';
      const noteHtml = returnNote
        ? `<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 12px;color:#555">${returnNote}</blockquote>`
        : '';
      const text = `The appraisal for ${staffName} (${appraisalPeriod}) has been returned to the appraiser for revision.${noteBlock}${link.text}`;
      const html = baseHtml(
        `<p>The appraisal for <strong>${staffName}</strong> (<strong>${appraisalPeriod}</strong>) has been returned to the appraiser for revision.</p>${noteHtml}${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsNextLevelSubmitted: {
      const subject = 'Next-level review has been submitted';
      const text = `The next-level review for ${staffName} (${appraisalPeriod}) has been submitted to HRA for finalization.${link.text}`;
      const html = baseHtml(
        `<p>The next-level review for <strong>${staffName}</strong> (<strong>${appraisalPeriod}</strong>) has been submitted to HRA for finalization.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.ExportReady: {
      const downloadPath = typeof ctx.downloadPath === 'string' ? ctx.downloadPath : '/hr/exports';
      const fullLink = typeof ctx.link === 'string' ? ctx.link : downloadPath;
      const subject = 'Your export is ready to download';
      const text = `Your PMS export is ready. Download it here: ${fullLink}`;
      const html = baseHtml(
        `<p>Your PMS org snapshot export is ready.</p><p><a href="${fullLink}" style="color:#4f46e5">Download the export</a></p>`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PmsReopened: {
      const subject = 'Your performance review has been reopened';
      const reopenNote = typeof ctx.reopenNote === 'string' ? ctx.reopenNote : '';
      const noteBlock = reopenNote ? `\n\nNote: ${reopenNote}` : '';
      const noteHtml = reopenNote
        ? `<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 12px;color:#555">${reopenNote}</blockquote>`
        : '';
      const text = `Your performance review for ${appraisalPeriod} has been reopened by HRA.${noteBlock}${link.text}`;
      const html = baseHtml(
        `<p>Your performance review for <strong>${appraisalPeriod}</strong> has been reopened by HRA.</p>${noteHtml}${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.ImpersonationStarted: {
      const impersonatorName =
        typeof ctx.impersonatorName === 'string' ? ctx.impersonatorName : 'An administrator';
      const expiresAt = typeof ctx.expiresAt === 'string' ? ctx.expiresAt : 'soon';
      const link = linkLine(ctx);
      const subject = 'Administrator is accessing your account';
      const text = `${impersonatorName} has started an impersonation session on your account. This session expires at ${expiresAt}. If this is unexpected, please contact IT support immediately.${link.text}`;
      const html = baseHtml(
        `<p><strong>${impersonatorName}</strong> has started an impersonation session on your account.</p><p>This session expires at <strong>${expiresAt}</strong>.</p><p>If this is unexpected, please contact IT support immediately.</p>${link.html}`,
      );
      return { subject, text, html };
    }

    case NotificationKind.InviteUser: {
      // ctx.inviteUrl is the primary link; ctx.link is the generic fallback used by the test suite
      const inviteUrl =
        typeof ctx.inviteUrl === 'string'
          ? ctx.inviteUrl
          : typeof ctx.link === 'string'
            ? ctx.link
            : '#';
      const subject = "You're invited to the performance platform";
      const text = `You have been invited to join the performance management platform. Click the link below to set up your account (expires in 7 days):\n\n${inviteUrl}\n\nIf you did not expect this invitation, please ignore this email.`;
      const html = baseHtml(
        `<p>You have been invited to join the performance management platform.</p><p>Click the link below to set up your account (link expires in 7 days):</p><p><a href="${inviteUrl}" style="color:#4f46e5">Accept invitation &amp; set password</a></p><p style="font-size:12px;color:#888">If you did not expect this invitation, please ignore this email.</p>`,
      );
      return { subject, text, html };
    }

    case NotificationKind.WelcomeUser: {
      const helpUrl =
        typeof ctx.helpUrl === 'string'
          ? ctx.helpUrl
          : typeof ctx.link === 'string'
            ? ctx.link
            : '/help';
      const recipientName = typeof ctx.name === 'string' ? ctx.name : 'there';
      const subject = 'Welcome to the performance platform';
      const text = `Hi ${recipientName},\n\nWelcome to the performance management platform. Here is a quick-start guide to help you get started:\n\n${helpUrl}\n\nIf you need immediate help, please contact HR.`;
      const html = baseHtml(
        `<p>Hi <strong>${recipientName}</strong>,</p><p>Welcome to the performance management platform.</p><p>Here's a quick-start guide to help you get started:</p><p><a href="${helpUrl}" style="color:#4f46e5">View Quickstart Guide</a></p><p>If you need immediate help, please contact HR.</p>`,
      );
      return { subject, text, html };
    }

    case NotificationKind.PasswordReset: {
      const resetUrl =
        typeof ctx.resetUrl === 'string'
          ? ctx.resetUrl
          : typeof ctx.link === 'string'
            ? ctx.link
            : '#';
      const subject = 'Password reset request';
      const text = `A password reset was requested for your account. Click the link below to set a new password (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not request this, please ignore this email. Your password will remain unchanged.`;
      const html = baseHtml(
        `<p>A password reset was requested for your account.</p><p>Click the link below to set a new password (link expires in 1 hour):</p><p><a href="${resetUrl}" style="color:#4f46e5">Reset password</a></p><p style="font-size:12px;color:#888">If you did not request this, please ignore this email. Your password will remain unchanged.</p>`,
      );
      return { subject, text, html };
    }

    case NotificationKind.AccessReviewGenerated: {
      const reviewUrl =
        typeof ctx.reviewUrl === 'string'
          ? ctx.reviewUrl
          : typeof ctx.link === 'string'
            ? ctx.link
            : '/admin/access-review';
      const itemCount = typeof ctx.itemCount === 'number' ? ctx.itemCount : 0;
      const periodLabel = typeof ctx.periodLabel === 'string' ? ctx.periodLabel : 'this quarter';
      const subject = `Quarterly access review — ${periodLabel}`;
      const text = `The quarterly access review for ${periodLabel} has been generated with ${itemCount} user(s) to review.\n\nPlease log in and complete the review within 30 days:\n\n${reviewUrl}`;
      const html = baseHtml(
        `<p>The quarterly access review for <strong>${periodLabel}</strong> has been generated.</p><p>There are <strong>${itemCount}</strong> user(s) to review.</p><p>Please complete the review within <strong>30 days</strong>.</p><p><a href="${reviewUrl}" style="color:#4f46e5">Go to Access Review</a></p>`,
      );
      return { subject, text, html };
    }

    default: {
      // Exhaustiveness check — caught at compile time if a new kind is added without a case.
      const _exhaustive: never = kind;
      void _exhaustive;
      return {
        subject: 'You have a new notification',
        text: 'You have received a new notification. Please log in to view it.',
        html: baseHtml('<p>You have received a new notification. Please log in to view it.</p>'),
      };
    }
  }
}
