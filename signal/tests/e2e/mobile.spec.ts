import { expect, test } from "@playwright/test";

test.describe("mobile journeys", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile only");

  test("navigation drawer reaches every section", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("link", { name: "Ticker Intelligence" }).click();
    await expect(page).toHaveURL(/\/ticker$/);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Model Scorecard" }).click();
    await expect(page).toHaveURL(/\/scorecard/);
  });

  test("filters popover and dossier work at phone width", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "High", exact: true }).click();
    await expect(page).toHaveURL(/severity=high/);
    await page.keyboard.press("Escape");
    await page.locator("article[data-card-id]").first().getByRole("link", { name: "Dossier" }).click();
    await expect(page.getByText("What changed — verified facts")).toBeVisible();
  });

  test("ticker detail and watchlist toggle", async ({ page }) => {
    await page.goto("/ticker/DURX");
    await expect(page.getByRole("heading", { name: "DURX" })).toBeVisible();
    // Retry until hydration attaches the handler (the button is server-rendered first).
    await expect(async () => {
      await page.getByRole("button", { name: /Watch/ }).click();
      await expect(page.getByRole("button", { name: "Watching" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await page.goto("/watchlists");
    await expect(page.locator("main").getByRole("link", { name: "DURX", exact: true })).toBeVisible();
  });

  test("search button opens the palette", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search tickers, events and pages" }).click();
    await page.getByPlaceholder("Search tickers, events, pages…").fill("oil");
    await expect(page.getByRole("option").first()).toBeVisible();
  });
});
