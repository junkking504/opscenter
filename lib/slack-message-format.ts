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
 * Every OpsCenter alert uses this one presentation contract: event first,
 * labelled facts, optional italic context, an explicit action, then one deep
 * link. Keep Slack-specific layout decisions here rather than in publishers.
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
  const contextLines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${slackEscape(line)}_`);

  return [
    `${icon} *${slackEscape(title)}*`,
    ...fieldLines,
    ...contextLines,
    nextAction ? `*Action:* ${slackEscape(nextAction)}` : "",
    href ? `<${href}|Open in OpsCenter>` : "",
  ].filter(Boolean).join("\n");
}
