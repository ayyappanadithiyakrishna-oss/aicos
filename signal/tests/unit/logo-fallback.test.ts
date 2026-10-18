import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Monogram, SecurityMark } from "@/components/ui/SecurityMark";

describe("logo fallback", () => {
  it("renders a monogram, never an <img>, without branding rights", () => {
    const html = renderToStaticMarkup(createElement(SecurityMark, { ticker: "HLCN", logoUrl: "https://logos.example/hlcn.png", brandingRights: "none" }));
    expect(html).toContain('data-testid="monogram"');
    expect(html).not.toContain("<img");
    expect(html).toContain("HL");
  });
  it("renders a monogram when rights exist but no logo URL", () => {
    const html = renderToStaticMarkup(createElement(SecurityMark, { ticker: "QQQ", logoUrl: null, brandingRights: "licensed" }));
    expect(html).toContain('data-testid="monogram"');
  });
  it("renders the licensed logo only with rights and a URL", () => {
    const html = renderToStaticMarkup(createElement(SecurityMark, { ticker: "HLCN", logoUrl: "https://logos.example/hlcn.png", brandingRights: "licensed" }));
    expect(html).toContain("<img");
  });
  it("monograms are decorative (ticker text carries meaning) and handle short tickers", () => {
    const html = renderToStaticMarkup(createElement(Monogram, { ticker: "A" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">A<");
  });
});
