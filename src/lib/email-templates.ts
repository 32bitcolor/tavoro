// Plain template literals, matching the house style already established in
// course-export-assets.ts for generating HTML outside the React tree — no
// templating library. Deliberately plain (a heading, a couple of lines): these
// are notifications, not marketing mail.

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

const FOOTER = `<p style="margin-top:24px;color:#888;font-size:12px">Tavoro</p>`;

function layout(heading: string, bodyHtml: string): string {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
  <h2 style="margin:0 0 12px">${heading}</h2>
  ${bodyHtml}
  ${FOOTER}
</div>`;
}

function button(url: string, label = "View in Tavoro →"): string {
  return `<p style="margin-top:20px"><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:14px">${esc(label)}</a></p>`;
}

type Email = { subject: string; html: string; text: string };

/** Append a "View in Tavoro" button (and the raw URL in the text part) to any
 *  templated email. No-op when url is undefined (e.g. APP_URL unset, or emails to
 *  external requesters who can't sign in). */
export function withLink(email: Email, url: string | undefined, label?: string): Email {
  if (!url) return email;
  return {
    subject: email.subject,
    html: email.html.replace(FOOTER, `${button(url, label)}\n  ${FOOTER}`),
    text: `${email.text}\n\n${url}`,
  };
}

export function intakeSubmittedConfirmation(params: { ticket: string; title: string; workspaceName: string }): Email {
  const { ticket, title, workspaceName } = params;
  return {
    subject: `We got your request — ${ticket}`,
    html: layout(
      "Thanks — your request is in",
      `<p>Reference: <strong>${esc(ticket)}</strong></p>
<p>${esc(title)}</p>
<p>The ${esc(workspaceName)} team will be in touch. You can follow your request, and talk to the team, on its page.</p>`,
    ),
    text: `Reference: ${ticket}\n${title}\n\nThe ${workspaceName} team will be in touch. You can follow your request, and talk to the team, on its page.`,
  };
}

export function newIntakeRequestForAdmin(params: {
  ticket: string;
  title: string;
  requesterName: string;
  workspaceName: string;
}): Email {
  const { ticket, title, requesterName, workspaceName } = params;
  return {
    subject: `New request — ${ticket}: ${title}`,
    html: layout(
      "New intake request",
      `<p><strong>${esc(ticket)}</strong> from ${esc(requesterName)}</p>
<p>${esc(title)}</p>
<p>Review it in ${esc(workspaceName)}'s Intake queue.</p>`,
    ),
    text: `${ticket} from ${requesterName}\n${title}\n\nReview it in ${workspaceName}'s Intake queue.`,
  };
}

export function intakeApprovedNotification(params: { ticket: string; title: string; workspaceName: string }): Email {
  const { ticket, title, workspaceName } = params;
  return {
    subject: `Your request was approved — ${ticket}`,
    html: layout(
      "Your request was approved",
      `<p>Reference: <strong>${esc(ticket)}</strong></p>
<p>"${esc(title)}" has been approved and is now moving forward with the ${esc(workspaceName)} team.</p>`,
    ),
    text: `Reference: ${ticket}\n"${title}" has been approved and is now moving forward with the ${workspaceName} team.`,
  };
}

export function intakeRejectedNotification(params: {
  ticket: string;
  title: string;
  workspaceName: string;
  reason: string | null;
}): Email {
  const { ticket, title, workspaceName, reason } = params;
  return {
    subject: `Update on your request — ${ticket}`,
    html: layout(
      "Update on your request",
      `<p>Reference: <strong>${esc(ticket)}</strong></p>
<p>"${esc(title)}" won't be moving forward with the ${esc(workspaceName)} team at this time.</p>
${reason ? `<p>${esc(reason)}</p>` : ""}`,
    ),
    text: `Reference: ${ticket}\n"${title}" won't be moving forward with the ${workspaceName} team at this time.${reason ? `\n\n${reason}` : ""}`,
  };
}

export function intakeAssigned(params: {
  ticket: string;
  title: string;
  requesterName: string;
  assignerName: string;
}): Email {
  const { ticket, title, requesterName, assignerName } = params;
  return {
    subject: `Assigned to you — ${ticket}: ${title}`,
    html: layout(
      "An intake request is yours",
      `<p>${esc(assignerName)} assigned you <strong>${esc(ticket)}</strong>, from ${esc(requesterName)}.</p>
<p>${esc(title)}</p>`,
    ),
    text: `${assignerName} assigned you ${ticket}, from ${requesterName}.\n${title}`,
  };
}

/** A team reply to the requester (or a question, when it marks the request Needs info).
 *  Pair with withLink(…, statusUrl, "View and reply"). */
export function intakeMessageToRequester(params: {
  ticket: string;
  title: string;
  workspaceName: string;
  authorName: string;
  body: string;
  question: boolean;
}): Email {
  const { ticket, title, workspaceName, authorName, body, question } = params;
  const heading = question ? "A question about your request" : "A message about your request";
  return {
    subject: `${heading} — ${ticket}`,
    html: layout(
      heading,
      `<p>Reference: <strong>${esc(ticket)}</strong> · ${esc(title)}</p>
<p>${esc(authorName)} from the ${esc(workspaceName)} team wrote:</p>
<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #ccc;white-space:pre-wrap">${esc(body)}</blockquote>
<p>Reply on your request page, or just reply to this email.</p>`,
    ),
    text: `Reference: ${ticket} · ${title}\n\n${authorName} from the ${workspaceName} team wrote:\n\n${body}\n\nReply on your request page, or just reply to this email.`,
  };
}

/** The requester replied on their status page. */
export function intakeRequesterReplied(params: { ticket: string; title: string; requesterName: string; body: string }): Email {
  const { ticket, title, requesterName, body } = params;
  return {
    subject: `${requesterName} replied — ${ticket}: ${title}`,
    html: layout(
      "The requester replied",
      `<p><strong>${esc(ticket)}</strong> · ${esc(title)}</p>
<p>${esc(requesterName)} wrote:</p>
<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #ccc;white-space:pre-wrap">${esc(body)}</blockquote>`,
    ),
    text: `${ticket} · ${title}\n\n${requesterName} wrote:\n\n${body}`,
  };
}

export function subtaskAssigned(params: {
  assigneeName: string;
  subtaskText: string;
  cardTitle: string;
  boardName: string;
}): Email {
  const { assigneeName, subtaskText, cardTitle, boardName } = params;
  return {
    subject: `You were assigned a subtask on "${cardTitle}"`,
    html: layout(
      "New subtask assigned to you",
      `<p>Hi ${esc(assigneeName)},</p>
<p><strong>${esc(subtaskText)}</strong></p>
<p>On card "${esc(cardTitle)}" in ${esc(boardName)}.</p>`,
    ),
    text: `Hi ${assigneeName},\n\n${subtaskText}\n\nOn card "${cardTitle}" in ${boardName}.`,
  };
}

export function cardAssigned(params: { assigneeName: string; cardTitle: string; boardName: string }): Email {
  const { assigneeName, cardTitle, boardName } = params;
  return {
    subject: `You were assigned "${cardTitle}"`,
    html: layout(
      "A card was assigned to you",
      `<p>Hi ${esc(assigneeName)},</p>
<p><strong>${esc(cardTitle)}</strong></p>
<p>On board ${esc(boardName)}.</p>`,
    ),
    text: `Hi ${assigneeName},\n\n${cardTitle}\n\nOn board ${boardName}.`,
  };
}

export function smeAssigned(params: { smeName: string; cardTitle: string; boardName: string }): Email {
  const { smeName, cardTitle, boardName } = params;
  return {
    subject: `You're the SME on "${cardTitle}"`,
    html: layout(
      "You were added as a subject-matter expert",
      `<p>Hi ${esc(smeName)},</p>
<p>You've been named the SME on <strong>${esc(cardTitle)}</strong>.</p>
<p>On board ${esc(boardName)}.</p>`,
    ),
    text: `Hi ${smeName},\n\nYou've been named the SME on "${cardTitle}".\n\nOn board ${boardName}.`,
  };
}

export function commentPosted(params: {
  recipientName: string;
  commenterName: string;
  cardTitle: string;
  boardName: string;
  excerpt: string;
}): Email {
  const { recipientName, commenterName, cardTitle, boardName, excerpt } = params;
  return {
    subject: `New comment on "${cardTitle}"`,
    html: layout(
      "New comment",
      `<p>Hi ${esc(recipientName)},</p>
<p>${esc(commenterName)} commented on <strong>${esc(cardTitle)}</strong> (${esc(boardName)}):</p>
<p style="border-left:3px solid #ddd;padding-left:12px;color:#444">${esc(excerpt)}</p>`,
    ),
    text: `Hi ${recipientName},\n\n${commenterName} commented on "${cardTitle}" (${boardName}):\n\n${excerpt}`,
  };
}

export function reviewRequested(params: {
  reviewerName: string;
  deliverableName: string;
  projectName: string;
  requesterName: string;
  dueDate: string | null;
}): Email {
  const { reviewerName, deliverableName, projectName, requesterName, dueDate } = params;
  return {
    subject: `Review requested: "${deliverableName}"`,
    html: layout(
      "You've been asked to review",
      `<p>Hi ${esc(reviewerName)},</p>
<p>${esc(requesterName)} asked you to review <strong>${esc(deliverableName)}</strong> in project "${esc(projectName)}".</p>
${dueDate ? `<p>Due by <strong>${esc(dueDate)}</strong>.</p>` : ""}`,
    ),
    text: `Hi ${reviewerName},\n\n${requesterName} asked you to review "${deliverableName}" in project "${projectName}".${dueDate ? `\n\nDue by ${dueDate}.` : ""}`,
  };
}

export function reviewDecided(params: {
  requesterName: string;
  deliverableName: string;
  projectName: string;
  reviewerName: string;
  decision: "approved" | "approved_with_changes" | "changes_requested";
  feedback?: string | null;
  commentCount?: number;
  /** Comments on screens changed since the previous round; null when there's no previous round to compare. */
  changedCount?: number | null;
  previousNumber?: number | null;
}): Email {
  const { requesterName, deliverableName, projectName, reviewerName, decision, feedback, commentCount = 0, changedCount, previousNumber } = params;
  const verb =
    decision === "approved" ? "approved" : decision === "approved_with_changes" ? "approved, with minor changes," : "requested changes on";
  const subject =
    decision === "approved"
      ? `Approved: "${deliverableName}"`
      : decision === "approved_with_changes"
        ? `Approved with minor changes: "${deliverableName}"`
        : `Changes requested: "${deliverableName}"`;
  const heading =
    decision === "approved" ? "Your review was approved" : decision === "approved_with_changes" ? "Approved, with minor changes" : "Changes were requested";
  const counts =
    commentCount > 0
      ? `${commentCount} comment${commentCount === 1 ? "" : "s"}${
          changedCount != null && previousNumber != null && changedCount > 0
            ? `, ${changedCount} on screens changed since round ${previousNumber}`
            : ""
        }.`
      : "";
  return {
    subject,
    html: layout(
      heading,
      `<p>Hi ${esc(requesterName)},</p>
<p>${esc(reviewerName)} ${verb} <strong>${esc(deliverableName)}</strong> in project "${esc(projectName)}".</p>
${counts ? `<p>${esc(counts)}</p>` : ""}
${feedback ? `<p style="border-left:3px solid #ddd;padding-left:12px;color:#444">${esc(feedback)}</p>` : ""}`,
    ),
    text: `Hi ${requesterName},\n\n${reviewerName} ${verb} "${deliverableName}" in project "${projectName}".${counts ? `\n\n${counts}` : ""}${feedback ? `\n\n${feedback}` : ""}`,
  };
}

export function memberWelcome(params: { name: string; workspaceName: string; inviterName: string }): Email {
  const { name, workspaceName, inviterName } = params;
  return {
    subject: `You've been added to ${workspaceName} on Tavoro`,
    html: layout(
      "Welcome to Tavoro",
      `<p>Hi ${esc(name)},</p>
<p>${esc(inviterName)} added you to the <strong>${esc(workspaceName)}</strong> workspace.</p>
<p>Ask ${esc(inviterName)} for your initial password, then sign in and change it under Settings → Account.</p>`,
    ),
    text: `Hi ${name},\n\n${inviterName} added you to the ${workspaceName} workspace.\n\nAsk ${inviterName} for your initial password, then sign in and change it under Settings → Account.`,
  };
}

export function passwordReset(params: { name: string; workspaceName: string; adminName: string }): Email {
  const { name, workspaceName, adminName } = params;
  return {
    subject: "Your Tavoro password was reset",
    html: layout(
      "Your password was reset",
      `<p>Hi ${esc(name)},</p>
<p>${esc(adminName)} reset your password for the <strong>${esc(workspaceName)}</strong> workspace. Ask them for the new password, then change it under Settings → Account.</p>
<p style="color:#888;font-size:12px">If you didn't expect this, contact your workspace admin.</p>`,
    ),
    text: `Hi ${name},\n\n${adminName} reset your password for the ${workspaceName} workspace. Ask them for the new password, then change it under Settings → Account.\n\nIf you didn't expect this, contact your workspace admin.`,
  };
}

export function cardDueReminder(params: { assigneeName: string; cardTitle: string; boardName: string; when: string }): Email {
  const { assigneeName, cardTitle, boardName, when } = params;
  return {
    subject: `Due ${when}: "${cardTitle}"`,
    html: layout(
      "A card is due soon",
      `<p>Hi ${esc(assigneeName)},</p>
<p><strong>${esc(cardTitle)}</strong> is due <strong>${esc(when)}</strong>.</p>
<p>On board ${esc(boardName)}.</p>`,
    ),
    text: `Hi ${assigneeName},\n\n${cardTitle} is due ${when}.\n\nOn board ${boardName}.`,
  };
}

export function mentioned(params: {
  recipientName: string;
  mentionerName: string;
  context: string; // "a comment" | "the description"
  cardTitle: string;
  boardName: string;
  excerpt?: string;
}): Email {
  const { recipientName, mentionerName, context, cardTitle, boardName, excerpt } = params;
  return {
    subject: `${mentionerName} mentioned you on "${cardTitle}"`,
    html: layout(
      "You were mentioned",
      `<p>Hi ${esc(recipientName)},</p>
<p>${esc(mentionerName)} mentioned you in ${esc(context)} on <strong>${esc(cardTitle)}</strong> (${esc(boardName)}).</p>
${excerpt ? `<p style="border-left:3px solid #ddd;padding-left:12px;color:#444">${esc(excerpt)}</p>` : ""}`,
    ),
    text: `Hi ${recipientName},\n\n${mentionerName} mentioned you in ${context} on "${cardTitle}" (${boardName}).${excerpt ? `\n\n${excerpt}` : ""}`,
  };
}

export function milestoneDueReminder(params: { recipientName: string; milestoneName: string; projectName: string; when: string }): Email {
  const { recipientName, milestoneName, projectName, when } = params;
  return {
    subject: `Milestone due ${when}: "${milestoneName}"`,
    html: layout(
      "A milestone is due soon",
      `<p>Hi ${esc(recipientName)},</p>
<p>Milestone <strong>${esc(milestoneName)}</strong> in project "${esc(projectName)}" is due <strong>${esc(when)}</strong>.</p>`,
    ),
    text: `Hi ${recipientName},\n\nMilestone "${milestoneName}" in project "${projectName}" is due ${when}.`,
  };
}

export function statusChanged(params: {
  recipientName: string;
  actorName: string;
  cardTitle: string;
  boardName: string;
  statusName: string;
}): Email {
  const { recipientName, actorName, cardTitle, boardName, statusName } = params;
  return {
    subject: `"${cardTitle}" moved to ${statusName}`,
    html: layout(
      "A card changed status",
      `<p>Hi ${esc(recipientName)},</p>
<p>${esc(actorName)} moved <strong>${esc(cardTitle)}</strong> to <strong>${esc(statusName)}</strong>.</p>
<p>On board ${esc(boardName)}.</p>`,
    ),
    text: `Hi ${recipientName},\n\n${actorName} moved "${cardTitle}" to ${statusName}.\n\nOn board ${boardName}.`,
  };
}

/** A watched card changed: "Sam changed the priority from Medium to High". */
export function watchedCardChanged(params: { recipientName: string; actorName: string; cardTitle: string; boardName: string; change: string }): Email {
  const { recipientName, actorName, cardTitle, boardName, change } = params;
  return {
    subject: `"${cardTitle}": ${actorName} ${change}`,
    html: layout(
      "A card you watch changed",
      `<p>Hi ${esc(recipientName)},</p>
<p>${esc(actorName)} ${esc(change)} on <strong>${esc(cardTitle)}</strong>.</p>
<p>On board ${esc(boardName)}. You get these because you watch this card; open it to stop watching.</p>`,
    ),
    text: `Hi ${recipientName},\n\n${actorName} ${change} on "${cardTitle}".\n\nOn board ${boardName}. You get these because you watch this card; open it to stop watching.`,
  };
}

export function subtaskStatusChanged(params: {
  recipientName: string;
  actorName: string;
  subtaskText: string;
  cardTitle: string;
  boardName: string;
  done: boolean;
}): Email {
  const { recipientName, actorName, subtaskText, cardTitle, boardName, done } = params;
  const verb = done ? "completed" : "reopened";
  return {
    subject: `Subtask ${verb} on "${cardTitle}"`,
    html: layout(
      `A subtask was ${verb}`,
      `<p>Hi ${esc(recipientName)},</p>
<p>${esc(actorName)} ${esc(verb)} <strong>${esc(subtaskText)}</strong>.</p>
<p>On card "${esc(cardTitle)}" in ${esc(boardName)}.</p>`,
    ),
    text: `Hi ${recipientName},\n\n${actorName} ${verb} "${subtaskText}".\n\nOn card "${cardTitle}" in ${boardName}.`,
  };
}

export function guestReviewInvite(params: {
  guestName: string;
  requesterName: string;
  deliverableName: string;
  workspaceName: string;
  roundNumber: number;
  dueDate: string | null;
  expires: string;
}): Email {
  const { guestName, requesterName, deliverableName, workspaceName, roundNumber, dueDate, expires } = params;
  const again = roundNumber > 1 ? ` This is round ${roundNumber}; the page highlights what changed since the last one.` : "";
  return {
    subject: `${requesterName} asked you to review "${deliverableName}"`,
    html: layout(
      "You've been asked to review",
      `<p>Hi ${esc(guestName)},</p>
<p>${esc(requesterName)} at ${esc(workspaceName)} asked you to review <strong>${esc(deliverableName)}</strong>.${esc(again)}</p>
${dueDate ? `<p>Please review by <strong>${esc(dueDate)}</strong>.</p>` : ""}
<p>No account needed: select any text to comment on it, then approve or request changes. The link is personal to you, so please don't forward it. It works until ${esc(expires)}.</p>`,
    ),
    text: `Hi ${guestName},\n\n${requesterName} at ${workspaceName} asked you to review "${deliverableName}".${again}${dueDate ? `\n\nPlease review by ${dueDate}.` : ""}\n\nNo account needed: select any text to comment on it, then approve or request changes. The link is personal to you, so please don't forward it. It works until ${expires}.`,
  };
}

export function reviewDueReminder(params: { reviewerName: string; deliverableName: string; when: string }): Email {
  const { reviewerName, deliverableName, when } = params;
  return {
    subject: `Review due ${when}: "${deliverableName}"`,
    html: layout(
      "A review is due soon",
      `<p>Hi ${esc(reviewerName)},</p>
<p>Your review of <strong>${esc(deliverableName)}</strong> is due <strong>${esc(when)}</strong>.</p>`,
    ),
    text: `Hi ${reviewerName},\n\nYour review of "${deliverableName}" is due ${when}.`,
  };
}

/** A tracked content item's review or expiry date is coming up (lib/reminders.ts). */
export function contentLifecycleReminder(params: {
  recipientName: string;
  title: string;
  kind: "review" | "expiry";
  when: string; // "in 30 days", "today"
  date: string; // "Jan 31, 2027"
}): Email {
  const { recipientName, title, kind, when, date } = params;
  const what = kind === "review" ? `is due for review ${when}` : `expires ${when}`;
  const next =
    kind === "review"
      ? "Look it over, then mark it reviewed in Tavoro to schedule the next review."
      : "Plan its replacement or retirement, or move the expiry date if it's still valid.";
  return {
    subject: kind === "review" ? `Review due ${when}: "${title}"` : `Expires ${when}: "${title}"`,
    html: layout(
      kind === "review" ? "Content due for review" : "Content expiring",
      `<p>Hi ${esc(recipientName)},</p>
<p><strong>${esc(title)}</strong> ${esc(what)} (${esc(date)}).</p>
<p>${esc(next)}</p>`,
    ),
    text: `Hi ${recipientName},\n\n"${title}" ${what} (${date}).\n\n${next}`,
  };
}

export function contentNeedsReviewAfterChange(params: { recipientName: string; title: string; changed: string; note: string | null; flaggedBy: string }): Email {
  const { recipientName, title, changed, note, flaggedBy } = params;
  return {
    subject: `Needs review: "${title}" (${changed} changed)`,
    html: layout(
      "Content needs review",
      `<p>Hi ${esc(recipientName)},</p>
<p>${esc(flaggedBy)} marked <strong>${esc(changed)}</strong> as changed. <strong>${esc(title)}</strong> depends on it, so it's been flagged for review.</p>
${note ? `<p style="border-left:3px solid #ddd;padding-left:10px;color:#444">${esc(note)}</p>` : ""}
<p>Check it still holds, update it if not, then mark it reviewed in Tavoro.</p>`,
    ),
    text: `Hi ${recipientName},\n\n${flaggedBy} marked "${changed}" as changed. "${title}" depends on it, so it's been flagged for review.${note ? `\n\n${note}` : ""}\n\nCheck it still holds, update it if not, then mark it reviewed in Tavoro.`,
  };
}

/** One email in place of many, after a bulk edit (lib/queues.ts withEmailDigest). */
export function bulkDigest(params: { actorName: string; count: number; items: { subject: string; url?: string }[] }): Email {
  const { actorName, count, items } = params;
  const shown = items.slice(0, 50);
  const more = items.length - shown.length;
  return {
    subject: `${actorName} changed ${count} ${count === 1 ? "card" : "cards"} you follow`,
    html: layout(
      `${esc(actorName)} made a bulk change`,
      `<p>${count === 1 ? "One update" : `${count} updates`} that you’d normally get one email each for:</p>
  <ul style="padding-left:18px">${shown.map((i) => `<li style="margin:4px 0">${i.url ? `<a href="${i.url}">${esc(i.subject)}</a>` : esc(i.subject)}</li>`).join("")}</ul>
  ${more > 0 ? `<p style="color:#666">…and ${more} more.</p>` : ""}`,
    ),
    text: `${actorName} made a bulk change:\n\n${shown.map((i) => `- ${i.subject}${i.url ? `\n  ${i.url}` : ""}`).join("\n")}${more > 0 ? `\n…and ${more} more.` : ""}`,
  };
}
