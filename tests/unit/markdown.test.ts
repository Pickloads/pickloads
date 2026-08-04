import { describe, expect, it } from "vitest";
import { readingMinutes, renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown — XSS safety (escape-first)", () => {
  it("escapes raw <script> tags to inert text", () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes inline HTML attributes and event handlers", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("drops javascript: links (renders the literal markdown)", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<a ");
    expect(html).toContain("[click me]");
  });

  it("drops data: and protocol-relative // links", () => {
    expect(
      renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4)"),
    ).not.toContain("<a ");
    expect(renderMarkdown("[x](//evil.example/path)")).not.toContain("<a ");
  });

  it("escapes HTML inside code blocks", () => {
    const html = renderMarkdown("```\n<script>bad()</script>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("renderMarkdown — supported constructs", () => {
  it("renders headings demoted one level (## → h3)", () => {
    expect(renderMarkdown("# Title")).toBe("<h2>Title</h2>");
    expect(renderMarkdown("## Section")).toBe("<h3>Section</h3>");
    expect(renderMarkdown("### Sub")).toBe("<h4>Sub</h4>");
  });

  it("renders bold, italic and inline code", () => {
    const html = renderMarkdown("A **bold** and *soft* `move`.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>soft</em>");
    expect(html).toContain("<code>move</code>");
  });

  it("renders https links with rel=noopener and relative links plain", () => {
    const external = renderMarkdown("[FMCSA](https://www.fmcsa.dot.gov)");
    expect(external).toContain('href="https://www.fmcsa.dot.gov"');
    expect(external).toContain('rel="noopener noreferrer"');
    const internal = renderMarkdown("[pricing](/dispatch)");
    expect(internal).toContain('<a href="/dispatch">pricing</a>');
    expect(internal).not.toContain("target=");
  });

  it("renders unordered and ordered lists", () => {
    expect(renderMarkdown("- one\n- two")).toBe(
      "<ul><li>one</li><li>two</li></ul>",
    );
    expect(renderMarkdown("1. first\n2. second")).toBe(
      "<ol><li>first</li><li>second</li></ol>",
    );
  });

  it("renders blockquotes, rules and joins paragraph lines", () => {
    expect(renderMarkdown("> wise words")).toBe(
      "<blockquote><p>wise words</p></blockquote>",
    );
    expect(renderMarkdown("---")).toBe("<hr />");
    expect(renderMarkdown("line one\nline two")).toBe(
      "<p>line one line two</p>",
    );
  });

  it("closes an unterminated code fence at EOF", () => {
    const html = renderMarkdown("```\nconst x = 1;");
    expect(html).toContain("<pre><code>const x = 1;</code></pre>");
  });
});

describe("readingMinutes", () => {
  it("estimates ~200wpm with a 1-minute floor", () => {
    expect(readingMinutes("just a few words")).toBe(1);
    expect(readingMinutes(Array(400).fill("word").join(" "))).toBe(2);
  });
});
