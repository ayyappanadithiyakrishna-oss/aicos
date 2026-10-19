import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Monogram } from "@/components/ui/SecurityMark";
import { LOGO_TICKERS } from "@/lib/live/logoTickers";

describe("ticker marks", () => {
  it("renders a monogram, never an <img>, for tickers outside the logo set (e.g. synthetic demo tickers)", () => {
    const html = renderToStaticMarkup(createElement(Monogram, { ticker: "HLCN" }));
    expect(html).toContain('data-testid="monogram"');
    expect(html).not.toContain("<img");
    expect(html).toContain("HL");
  });
  it("renders a same-origin logo for covered large caps", () => {
    expect(LOGO_TICKERS.has("AAPL")).toBe(true);
    const html = renderToStaticMarkup(createElement(Monogram, { ticker: "AAPL" }));
    expect(html).toContain('src="/api/logo/AAPL"');
    expect(html).toContain('alt=""');
  });
  it("marks are decorative (ticker text carries meaning) and handle short tickers", () => {
    const html = renderToStaticMarkup(createElement(Monogram, { ticker: "ZZ" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">Z<");
  });
});
