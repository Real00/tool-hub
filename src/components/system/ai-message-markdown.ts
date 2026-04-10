import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import MarkdownIt from "markdown-it";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("ps1", powershell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("xml", xml);

const markdownCache = new Map<string, string>();

function makeCodeBlockId(): string {
  return `ai-code-${Math.random().toString(36).slice(2, 10)}`;
}

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code: string, language: string) {
    const normalizedLanguage = String(language ?? "").trim().toLowerCase();
    const highlighted =
      normalizedLanguage && hljs.getLanguage(normalizedLanguage)
        ? hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value
        : hljs.highlightAuto(code).value;
    const blockId = makeCodeBlockId();
    const label = normalizedLanguage
      ? `<span class="text-[11px] uppercase tracking-[0.16em] text-slate-500">${escapeHtml(normalizedLanguage)}</span>`
      : "";
    const copyButton = `<button type="button" class="ai-chat-copy-btn rounded-md border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 transition hover:border-emerald-400 hover:text-emerald-200" data-copy-target="${blockId}" aria-label="Copy code" title="Copy code">Copy</button>`;
    return `<div class="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95"><div class="flex items-center justify-between gap-3 border-b border-slate-700/80 px-3 py-1.5">${label || '<span class="text-[11px] uppercase tracking-[0.16em] text-slate-600">code</span>'}${copyButton}</div><pre class="overflow-x-auto px-4 py-4 text-[13px] leading-6 text-slate-300"><code id="${blockId}" class="hljs font-mono">${highlighted}</code></pre></div>`;
  },
});

markdownRenderer.linkify.set({
  fuzzyEmail: false,
  fuzzyIP: false,
});

markdownRenderer.renderer.rules.link_open = (
  tokens: Array<{ attrGet: (name: string) => string | null; attrSet: (name: string, value: string) => void; attrJoin: (name: string, value: string) => void }>,
  idx: number,
  options: unknown,
  _env: unknown,
  self: { renderToken: (tokensInput: unknown, idxInput: number, optionsInput: unknown) => string },
) => {
  const token = tokens[idx];
  const href = token.attrGet("href");
  if (!href || !/^(https?:|mailto:)/i.test(href)) {
    token.attrSet("href", "#");
  }
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noreferrer");
  token.attrJoin(
    "class",
    "text-emerald-300 underline decoration-emerald-500/40 underline-offset-4 transition hover:text-emerald-200",
  );
  return self.renderToken(tokens, idx, options);
};

markdownRenderer.renderer.rules.paragraph_open = () =>
  '<p class="text-sm leading-[1.45rem] text-slate-300">';
markdownRenderer.renderer.rules.heading_open = (
  tokens: Array<{ tag: string }>,
  idx: number,
) => {
  const tag = tokens[idx].tag;
  const classMap: Record<string, string> = {
    h1: "text-2xl font-semibold text-slate-200",
    h2: "text-xl font-semibold text-slate-200",
    h3: "text-lg font-semibold text-slate-200",
    h4: "text-base font-semibold text-slate-200",
    h5: "text-sm font-semibold uppercase tracking-[0.14em] text-slate-300",
    h6: "text-sm font-medium uppercase tracking-[0.14em] text-slate-400",
  };
  return `<${tag} class="${classMap[tag] ?? "text-base font-semibold text-slate-200"}">`;
};
markdownRenderer.renderer.rules.blockquote_open = () =>
  '<blockquote class="rounded-r-2xl border-l-4 border-emerald-500/60 bg-emerald-500/5 px-4 py-3 text-sm leading-[1.45rem] text-slate-300">';
markdownRenderer.renderer.rules.bullet_list_open = () =>
  '<ul class="list-disc space-y-1.5 pl-5">';
markdownRenderer.renderer.rules.ordered_list_open = () =>
  '<ol class="list-decimal space-y-1.5 pl-5">';
markdownRenderer.renderer.rules.list_item_open = () =>
  '<li class="text-sm leading-[1.45rem] text-slate-300">';
markdownRenderer.renderer.rules.code_inline = (
  tokens: Array<{ content: string }>,
  idx: number,
) => {
  return `<code class="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[0.95em] text-emerald-300">${escapeHtml(tokens[idx].content)}</code>`;
};
markdownRenderer.renderer.rules.table_open = () =>
  '<div class="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/80"><table class="min-w-full border-collapse text-sm text-slate-300">';
markdownRenderer.renderer.rules.table_close = () => "</table></div>";
markdownRenderer.renderer.rules.thead_open = () =>
  '<thead class="border-b border-slate-700 bg-slate-900/80 text-slate-200">';
markdownRenderer.renderer.rules.th_open = () =>
  '<th class="px-3 py-2 text-left font-medium">';
markdownRenderer.renderer.rules.td_open = () =>
  '<td class="border-t border-slate-800 px-3 py-2 align-top">';
markdownRenderer.renderer.rules.hr = () =>
  '<hr class="border-slate-700/80" />';

function escapeHtml(input: string): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAiMessageMarkdown(input: string): string {
  const source = String(input ?? "");
  const cached = markdownCache.get(source);
  if (cached) {
    return cached;
  }
  const rendered = markdownRenderer.render(source);
  const sanitized = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: [
      "a",
      "blockquote",
      "button",
      "br",
      "code",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "li",
      "ol",
      "p",
      "pre",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "ul",
    ],
    ALLOWED_ATTR: ["class", "href", "id", "rel", "target", "type", "data-copy-target"],
  });
  const content =
    sanitized || `<p class="text-sm leading-7 text-slate-300">${escapeHtml(source)}</p>`;
  const output = `<div class="space-y-5">${content}</div>`;
  markdownCache.set(source, output);
  if (markdownCache.size > 120) {
    const oldestKey = markdownCache.keys().next().value;
    if (typeof oldestKey === "string") {
      markdownCache.delete(oldestKey);
    }
  }
  return output;
}
