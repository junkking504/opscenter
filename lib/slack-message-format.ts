export type SlackMessageField = {
  label: string;
  value: string | number;
};

function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanInline(value: string | number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatSlackFieldLines(fields: SlackMessageField[]): string[] {
  return fields.flatMap((field) => {
    const label = cleanInline(field.label).replace(/:+$/, "");
    const value = cleanInline(field.value);
    return label && value ? [`*${escapeSlackText(label)}:* ${escapeSlackText(value)}`] : [];
  });
}

export function formatOpsCenterSlackMessage(input: {
  title: string;
  subject?: string;
  fields?: SlackMessageField[];
  lines?: string[];
  href?: string;
  linkLabel?: string;
}): string {
  const output = [`*${escapeSlackText(cleanInline(input.title))}*`];
  const subject = cleanInline(input.subject || "");
  if (subject) output.push(escapeSlackText(subject));

  // Slack wraps plain text naturally on narrow screens. Avoid code blocks here:
  // their fixed-width columns cause long addresses to wrap out of alignment.
  output.push(...formatSlackFieldLines(input.fields || []));
  output.push(...(input.lines || []).map(cleanInline).filter(Boolean).map(escapeSlackText));

  const href = cleanInline(input.href || "");
  if (href) output.push(`<${href}|${escapeSlackText(cleanInline(input.linkLabel || "Open in OpsCenter"))}>`);
  return output.join("\n");
}
