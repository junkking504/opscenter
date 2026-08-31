import fs from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import selectorParser, { type Selector } from "postcss-selector-parser";

const root = process.cwd();
const styleFiles = [
  "app/globals.css",
  "app/ops-redesign.css",
  "app/ops-design-system.css",
  "app/dashboard-v2.css",
  "app/ops-usability.css",
  "app/crew-responsive.css",
  "app/compact-verifiers.css",
  "app/ops-visual-system.css",
] as const;

// These component families were checked against all runtime TS/JS/HTML/MDX
// sources. Keep this list explicit so a future use fails the audit instead of
// being silently pruned as "probably unused."
const auditedUnusedRootClasses = [
  "ops-brand-mark",
  "ops-command-center-v2",
  "ops-command-center-v2-grid",
  "ops-command-center-v2-head",
  "ops-command-readiness-v2",
  "ops-compact-jobs-table",
  "ops-health-card-v2",
  "ops-health-stack-v2",
  "ops-job-address",
  "ops-job-amount",
  "ops-job-card",
  "ops-job-contact-line",
  "ops-job-main",
  "ops-job-meta-grid",
  "ops-job-photo-badge",
  "ops-job-subtle",
  "ops-jobs-filter-details",
  "ops-jobs-mode-toggle",
  "ops-jobs-search-field",
  "ops-jobs-workspace-nav",
  "ops-payment-badge",
  "ops-physical-truck-badge",
  "ops-priority-column-v2",
  "ops-priority-column-v2-head",
  "ops-priority-item-v2",
  "ops-priority-list-v2",
  "ops-revenue-hero-v2",
  "ops-revenue-hero-v2-foot",
  "ops-revenue-hero-v2-top",
  "ops-revenue-hero-v2-value",
  "ops-revenue-hero-v2-variance",
  "ops-revenue-progress-v2",
] as const;

type RuleRecord = {
  context: string;
  declarations: Map<string, boolean>;
  endLine: number;
  file: string;
  fileIndex: number;
  selector: string;
  selectors: string[];
  startLine: number;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function atRuleContext(rule: Rule): string {
  const ancestors: string[] = [];
  let current = rule.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule") {
      const atRule = current as AtRule;
      ancestors.unshift(`@${atRule.name.toLowerCase()} ${normalizeWhitespace(atRule.params)}`);
    }
    current = current.parent;
  }
  return ancestors.join(" > ");
}

function normalizedSelectors(selector: string): string[] {
  const selectors: string[] = [];
  selectorParser((parsed) => {
    parsed.each((entry) => {
      selectors.push(normalizeWhitespace(entry.toString()));
    });
  }).processSync(selector);
  return selectors;
}

function declarationMap(rule: Rule): Map<string, boolean> {
  const declarations = new Map<string, boolean>();
  rule.each((node) => {
    if (node.type !== "decl") return;
    const declaration = node as Declaration;
    const property = declaration.prop.toLowerCase();
    declarations.set(property, Boolean(declaration.important) || Boolean(declarations.get(property)));
  });
  return declarations;
}

function readRules(): RuleRecord[] {
  const records: RuleRecord[] = [];
  styleFiles.forEach((file, fileIndex) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const parsed = postcss.parse(source, { from: file });
    parsed.walkRules((rule) => {
      const declarations = declarationMap(rule);
      if (declarations.size === 0 || !rule.source?.start || !rule.source.end) return;
      let selectors: string[];
      try {
        selectors = normalizedSelectors(rule.selector);
      } catch {
        return;
      }
      if (selectors.length === 0) return;
      records.push({
        context: atRuleContext(rule),
        declarations,
        endLine: rule.source.end.line,
        file,
        fileIndex,
        selector: normalizeWhitespace(rule.selector),
        selectors,
        startLine: rule.source.start.line,
      });
    });
  });
  return records;
}

function isFullyOverridden(record: RuleRecord, records: RuleRecord[]): boolean {
  return record.selectors.every((selector) => {
    const later = records.filter(
      (candidate) => candidate.fileIndex > record.fileIndex
        && candidate.context === record.context
        && candidate.selectors.includes(selector),
    );
    if (later.length === 0) return false;
    return [...record.declarations].every(([property, important]) => later.some((candidate) => {
      if (!candidate.declarations.has(property)) return false;
      return !important || candidate.declarations.get(property) === true;
    }));
  });
}

function sourceCorpus(): string {
  const extensions = new Set([".cjs", ".html", ".js", ".jsx", ".mdx", ".mjs", ".ts", ".tsx"]);
  const excludedDirectories = new Set([".git", ".next", "data", "node_modules", "public", "worktrees"]);
  const chunks: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        if (absolute === path.join(root, "scripts/analyze-shared-css.ts")) continue;
        chunks.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(root);
  return chunks.join("\n");
}

function selectorHasAbsentLiteral(selector: string, corpus: string): boolean {
  let absent = false;
  selectorParser((parsed) => {
    const topLevel = parsed.first as Selector | undefined;
    if (!topLevel) return;
    let hasUnsafeConstruct = false;
    const tokens: string[] = [];
    topLevel.walk((node) => {
      if (node.type === "attribute") hasUnsafeConstruct = true;
      if (node.type === "pseudo" && node.nodes?.length) hasUnsafeConstruct = true;
      if (node.type === "class" || node.type === "id") tokens.push(node.value);
    });
    if (!hasUnsafeConstruct && tokens.length > 0) {
      absent = tokens.some((token) => !corpus.includes(token));
    }
  }).processSync(selector);
  return absent;
}

function isStaticallyUnmatched(record: RuleRecord, corpus: string): boolean {
  try {
    return record.selectors.every((selector) => selectorHasAbsentLiteral(selector, corpus));
  } catch {
    return false;
  }
}

function includesClass(selector: string, className: string): boolean {
  let included = false;
  selectorParser((parsed) => {
    const entry = parsed.first;
    if (!entry) return;
    entry.walkClasses((classNode) => {
      if (classNode.value !== className) return;
      let parent = classNode.parent;
      while (parent && parent !== entry) {
        if (parent.type === "pseudo" && [":is", ":not", ":where"].includes(parent.value)) return;
        parent = parent.parent;
      }
      included = true;
    });
  }).processSync(selector);
  return included;
}

function corpusIncludesClass(corpus: string, className: string): boolean {
  return new RegExp(`(^|[^\\w-])${className}(?![\\w-])`, "m").test(corpus);
}

const records = readRules();
const corpus = sourceCorpus();
const fullyOverridden = records.filter((record) => isFullyOverridden(record, records));
const staticallyUnmatched = records.filter((record) => isStaticallyUnmatched(record, corpus));
for (const className of auditedUnusedRootClasses) {
  if (corpusIncludesClass(corpus, className)) {
    throw new Error(`Audited unused class is now present in runtime source: ${className}`);
  }
}
const demonstrablyUnused = records.filter((record) => record.selectors.every((selector) =>
  auditedUnusedRootClasses.some((className) => includesClass(selector, className)),
));

const lineCount = (recordsToCount: RuleRecord[]) => recordsToCount.reduce(
  (total, record) => total + record.endLine - record.startLine + 1,
  0,
);

console.log(JSON.stringify({
  files: styleFiles.map((file) => ({
    file,
    lines: fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).length,
  })),
  fullyOverridden: {
    count: fullyOverridden.length,
    lines: lineCount(fullyOverridden),
    rules: fullyOverridden,
  },
  demonstrablyUnused: {
    count: demonstrablyUnused.length,
    lines: lineCount(demonstrablyUnused),
    rules: demonstrablyUnused,
  },
  ruleCount: records.length,
  literalSourceCandidates: {
    count: staticallyUnmatched.length,
    lines: lineCount(staticallyUnmatched),
    rules: staticallyUnmatched,
  },
}, null, 2));
