export type SlackMessageField = {
  label: string;
  value: string | number | null | undefined;
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
  const fieldLines = fields.flatMap(({ label, value }) => {
    const text = String(value ?? "").trim();
    return text ? [`*${slackEscape(label)}:* ${slackEscape(text)}`] : [];
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
