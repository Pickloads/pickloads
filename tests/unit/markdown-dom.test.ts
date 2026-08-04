// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

/**
 * DOM-level proof (jsdom) that the renderer's output is inert when parsed by
 * a real HTML parser — the exact path the blog takes via
 * dangerouslySetInnerHTML.
 */
describe("renderMarkdown output parsed into a real DOM", () => {
  function mount(markdown: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(markdown);
    return host;
  }

  it("produces zero script elements from hostile input", () => {
    const host = mount(
      '# Hi\n\n<script>window.pwned = true</script>\n\n<img src=x onerror="window.pwned=true">',
    );
    expect(host.querySelectorAll("script").length).toBe(0);
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(
      (window as unknown as Record<string, unknown>)["pwned"],
    ).toBeUndefined();
  });

  it("produces no javascript: hrefs and marks external links noopener", () => {
    const host = mount(
      "[bad](javascript:alert(1)) and [good](https://example.com)",
    );
    const anchors = Array.from(host.querySelectorAll("a"));
    expect(anchors.length).toBe(1);
    const anchor = anchors[0];
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a full article structure", () => {
    const host = mount(
      "# Fuel costs\n\nIntro **para**.\n\n- point one\n- point two\n\n> quote",
    );
    expect(host.querySelector("h2")?.textContent).toBe("Fuel costs");
    expect(host.querySelector("strong")?.textContent).toBe("para");
    expect(host.querySelectorAll("ul li").length).toBe(2);
    expect(host.querySelector("blockquote p")?.textContent).toBe("quote");
  });
});
