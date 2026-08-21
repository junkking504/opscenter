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

export function formatSlackAlignedFields(fields: SlackMessageField[]): string {
  const normalized = fields
    .map((field) => ({ label: cleanInline(field.label).replace(/:+$/, ""), value: cleanInline(field.value) }))
    .filter((field) => field.label && field.value);
  const width = Math.max(0, ...normalized.map((field) => `${field.label}:`.length)) + 2;
  return normalized
    .map((field) => `${`${field.label}:`.padEnd(width)}${field.value}`)
    .join("\n");
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

  const alignedFields = formatSlackAlignedFields(input.fields || []);
  const lines = (input.lines || []).map(cleanInline).filter(Boolean).join("\n");
  const codeBlock = alignedFields || lines;
  if (codeBlock) output.push("```", escapeSlackText(codeBlock).replace(/```/g, "'''"), "```");

  const href = cleanInline(input.href || "");
  if (href) output.push(`<${href}|${escapeSlackText(cleanInline(input.linkLabel || "Open in OpsCenter"))}>`);
  return output.join("\n");
}
