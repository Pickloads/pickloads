/**
 * M-33 — minimal, safe Markdown → HTML renderer for blog posts.
 *
 * Deliberately tiny (no new dependency, CLAUDE.md "no heavy deps"):
 * ALL input is HTML-escaped first, then a small allow-list of constructs is
 * rebuilt on top of the escaped text, so raw HTML/script in body_md can never
 * reach the page. Authors are staff, but defense in depth costs nothing.
 *
 * Supported: # ## ### headings · paragraphs · **bold** · *italic* ·
 * `inline code` · fenced ``` code blocks · [text](https://… | /relative)
 * links · - / * unordered lists · 1. ordered lists · > blockquotes · ---
 * rules. Everything else renders as literal text.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** http(s) absolute or site-relative — everything else is dropped. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return null;
}

/** Inline constructs, applied to already-escaped text. */
function renderInline(escaped: string): string {
  let out = escaped;
  // inline code first so its content is exempt from bold/italic/link parsing
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^()\s]+)\)/g,
    (match: string, text: string, href: string): string => {
      const safe = safeHref(href);
      if (!safe) return match;
      const external = /^https?:\/\//i.test(safe);
      return `<a href="${escapeHtml(safe)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
    },
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let codeBlock: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(escapeHtml(paragraph.join(" ")))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${tag}>`,
      );
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      html.push(
        `<blockquote><p>${renderInline(escapeHtml(quote.join(" ")))}</p></blockquote>`,
      );
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    // fenced code blocks
    if (codeBlock !== null) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${codeBlock.join("\n")}</code></pre>`);
        codeBlock = null;
      } else {
        codeBlock.push(escapeHtml(line));
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushAll();
      codeBlock = [];
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading && heading[1] && heading[2] !== undefined) {
      flushAll();
      // h1 is the page title — demote body headings to h2/h3/h4
      const level = heading[1].length + 1;
      html.push(
        `<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`,
      );
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushAll();
      html.push("<hr />");
      continue;
    }

    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (unordered?.[1] !== undefined || ordered?.[1] !== undefined) {
      flushParagraph();
      flushQuote();
      const isOrdered = ordered?.[1] !== undefined;
      const content = (isOrdered ? ordered?.[1] : unordered?.[1]) ?? "";
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(renderInline(escapeHtml(content)));
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(line);
    if (quoted && quoted[1] !== undefined) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (codeBlock !== null) {
    html.push(`<pre><code>${codeBlock.join("\n")}</code></pre>`);
  }
  flushAll();
  return html.join("\n");
}

/** ~200 wpm reading-time estimate for the card meta line. */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
