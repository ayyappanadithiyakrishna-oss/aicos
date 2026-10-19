import { expect, test } from "@playwright/test";

test.describe("intelligence feed", () => {
  test("shows the unmistakable demo label and insight-first cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("note", { name: "Demo mode" })).toContainText("Demo · synthetic data");
    const cards = page.locator("article[data-card-id]");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(10);
    await expect(cards.first().locator("h3")).not.toBeEmpty();
    await expect(cards.first()).toContainText("Exposed assets");
  });

  test("category and search filters narrow the feed and can be cleared", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /^Macro/ }).click();
    await expect(page).toHaveURL(/category=macro/);
    await expect(page.locator("article[data-card-id]").first()).toContainText(/CPI|Payrolls|Retail/i);
    const n = await page.locator("article[data-card-id]").count();
    expect(n).toBeLessThanOrEqual(4);
    await page.getByRole("tab", { name: /^All/ }).click();
    await page.getByPlaceholder("Filter by ticker, company, topic").fill("zzzz-no-match");
    await expect(page.getByText("No events matched")).toBeVisible();
    await page.getByRole("button", { name: "Remove filters" }).click();
    await expect(page.locator("article[data-card-id]").first()).toBeVisible();
  });

  test("expands mechanics and opens 'why this ticker'", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("article[data-card-id]").first();
    await card.getByRole("button", { name: "View mechanics" }).click();
    await expect(card.getByText("Scenarios")).toBeVisible();
    await card.getByRole("button", { name: /Why this ticker\?/ }).first().click();
    await expect(page.getByText("Why this ticker?").first()).toBeVisible();
    await expect(page.getByText(/Model view ·/)).toBeVisible();
  });

  test("bookmarks persist to Saved Research", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("article[data-card-id]").first();
    const title = (await card.locator("h3").innerText()).trim();
    await card.getByRole("button", { name: "Bookmark" }).click();
    await page.goto("/saved");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("dossier shows facts, mechanism, forecasts, contradictions and sources", async ({ page }) => {
    await page.goto("/");
    await page.locator("article[data-card-id]").first().getByRole("link", { name: "Dossier" }).click();
    await expect(page.getByText("What changed — verified facts")).toBeVisible();
    await expect(page.getByText("Transmission mechanism")).toBeVisible();
    await expect(page.getByText("Impacted assets · model-estimated abnormal reaction")).toBeVisible();
    await expect(page.getByText("Contradictions & what would falsify the view")).toBeVisible();
    await expect(page.getByText("Who said what")).toBeVisible();
  });

  test("command palette finds a ticker", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard shortcut is desktop-only; search button covered in mobile spec");
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Search tickers, events, pages…").fill("HLCN");
    await expect(page.getByRole("option", { name: /HLCN/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ticker\/HLCN/);
  });
});

test.describe("other views", () => {
  test("ticker cockpit renders chart with source label and history", async ({ page }) => {
    await page.goto("/ticker/HLCN");
    await expect(page.getByRole("heading", { name: "HLCN" })).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.getByText(/Synthetic price path/).first()).toBeVisible();
    await expect(page.getByText("Predicted vs. actual reaction history")).toBeVisible();
    await expect(page.getByText(/No entitled options chain/)).toBeVisible();
  });

  test("market pulse separates observed moves from hypotheses", async ({ page }) => {
    await page.goto("/pulse");
    await expect(page.getByRole("heading", { name: /Drivers of MKTX today/ })).toBeVisible();
    await expect(page.getByText(/not causal attribution|not verified causal attribution/).first()).toBeVisible();
  });

  test("scorecard withholds nothing silently and shows OOS vs in-sample", async ({ page }) => {
    await page.goto("/scorecard");
    await expect(page.getByText(/Out-of-sample \(walk-forward\)/)).toBeVisible();
    await expect(page.getByText(/In-sample \(training data/)).toBeVisible();
    await expect(page.getByText(/Confusion matrix/)).toBeVisible();
  });

  test("impact map, macro, filings, calendar, forecast lab and status load", async ({ page }) => {
    for (const [path, text] of [
      ["/impact-map", "Impact map"],
      ["/macro", "Macro radar"],
      ["/filings", "Earnings & filings"],
      ["/calendar", "Catalyst calendar"],
      ["/forecast-lab", "Forecast lab"],
      ["/status", "Data status"],
      ["/methodology", "Methodology"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: text })).toBeVisible();
    }
  });

  test("unknown routes show a helpful 404", async ({ page }) => {
    const r = await page.goto("/ticker/NOPEX");
    expect(r?.status()).toBe(404);
    await expect(page.getByText("Not in this feed")).toBeVisible();
  });
});
