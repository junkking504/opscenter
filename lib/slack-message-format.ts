export type SlackMessageField = {
  label: string;
  value: string | number | null | undefined;
  href?: string;
};

export type SlackMessageOptions = {
  icon: string;
  title: string;
  fields?: SlackMessageField[];
  body?: string;
  nextAction?: string;
  href?: string;
};

export function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Keep every OpsCenter alert scannable in Slack: event first, then labelled
 * facts, then the optional action and OpsCenter deep link.
 */
export function formatSlackMessage({
  icon,
  title,
  fields = [],
  body = "",
  nextAction = "",
  href = "",
}: SlackMessageOptions): string {
  const fieldLines = fields.flatMap(({ label, value, href: fieldHref }) => {
    const text = String(value ?? "").trim();
    if (!text) return [];
    const href = String(fieldHref || "").trim();
    const renderedValue = href ? `<${href}|${slackEscape(text)}>` : slackEscape(text);
    return [`*${slackEscape(label)}:* ${renderedValue}`];
  });
  const bodyLines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(slackEscape);

  return [
    `${icon} *${slackEscape(title)}*`,
    ...fieldLines,
    ...bodyLines,
    nextAction ? `*Next:* ${slackEscape(nextAction)}` : "",
    href ? `<${href}|Open in OpsCenter>` : "",
  ].filter(Boolean).join("\n");
}
