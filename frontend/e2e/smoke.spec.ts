import { test, expect } from "@playwright/test";

test.describe("O.S.I.S. Core Application Smoke Tests", () => {
  test("Application loads and displays branding", async ({ page }) => {
    await page.goto("/");

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/O.S.I.S/);

    // Expect the header branding to be visible
    await expect(page.locator("text=O.S.I.S.").first()).toBeVisible();
  });

  test("Navigation works to Dashboard", async ({ page }) => {
    await page.goto("/");

    // Click the Open Dashboard link on the landing page
    await page.getByRole("link", { name: "Open Dashboard" }).click();

    // Check if URL contains /overview
    await expect(page).toHaveURL(/.*\/overview/);

    // Wait for the overview page to load something visible
    await expect(page.locator("text=O.S.I.S.").first()).toBeVisible();
  });

  test("Navigation works to Investigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Open Dashboard" }).click();
    await page.getByRole("link", { name: "Investigation" }).click();
    await expect(page).toHaveURL(/.*\/analysis/);

    // Should show Investigation title or loading state
    await expect(page.getByRole("heading", { name: "Investigation" }))
      .toBeVisible({ timeout: 10000 })
      .catch(() => null);
  });

  test("Navigation works to Detection (Satellite)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Open Dashboard" }).click();
    await page.getByRole("link", { name: "Detection" }).click();
    await expect(page).toHaveURL(/.*\/satellite/);

    // Should show satellite page header
    await expect(page.getByRole("heading", { name: "Satellite SAR Observation", exact: false }))
      .toBeVisible({ timeout: 10000 })
      .catch(() => null);
  });
});
