import { type Page, expect, test } from "@playwright/test";

async function openPlayground(page: Page) {
  await page.goto("/playground");
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
}
const panel = (page: Page) => page.getByTestId("quera-panel");
const answers = (page: Page) => page.getByTestId("quera-msg");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Start each test clean, but keep storage across reloads inside a test.
    if (!window.sessionStorage.getItem("qc-e2e-init")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("qc-e2e-init", "1");
    }
  });
});

test("Quera opens from the launcher and offers suggestions that match the query state", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("sample-select").selectOption("bad-column");
  await expect(page.getByTestId("analysis-outcome")).toHaveText("Analysis Failed");
  await expect(page.getByTestId("quera-launcher")).toContainText("Explain this error");
  await page.getByTestId("quera-launcher").click();
  await expect(panel(page)).toHaveAttribute("data-open", "true");
  await expect(page.getByRole("heading", { name: "Quera online" })).toBeVisible();
  await expect(page.getByTestId("quera-context")).toContainText("SELECT nam FROM students");
  await expect(page.getByTestId("quera-context")).toContainText("1 error");
  await expect(page.getByRole("button", { name: "Why did my query fail?" })).toBeVisible();
});

test("answers using the real compiler output, streams, and renders markdown with a SQL action", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("sample-select").selectOption("bad-column");
  await expect(page.getByTestId("analysis-outcome")).toHaveText("Analysis Failed");
  await page.getByTestId("quera-launcher").click();
  await page.getByRole("button", { name: "Why did my query fail?" }).click();

  await expect(page.getByTestId("quera-user-msg")).toHaveText("Why did my query fail?");
  await expect(answers(page).first()).toContainText("Here is what I see", { timeout: 15_000 });
  await expect(answers(page).first()).toContainText("FAILED during semantic");
  await expect(answers(page).first()).toContainText("QC3004");
  await expect(answers(page).first().getByRole("heading", { name: "Here is what I see" })).toBeVisible();

  // The suggested fix can be dropped into the editor.
  await answers(page).first().getByRole("button", { name: /Use in editor/ }).click();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("SELECT name FROM students WHERE marks > 80;");
});

test("waits out a provider limit without ever telling the user about it", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("quera-launcher").click();
  await page.getByTestId("quera-input").fill("[throttle] explain my query");
  await page.getByTestId("quera-send").click();

  const started = Date.now();
  await expect(page.getByTestId("quera-thinking")).toBeVisible();
  await expect(answers(page).first()).toContainText("Here is what I see", { timeout: 20_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(2_000); // it really waited for the 2s window
  const text = (await panel(page).innerText()).toLowerCase();
  for (const word of ["rate limit", "rate-limit", "too many requests", "quota", "429", "try again in"]) expect(text).not.toContain(word);
  await expect(page.getByTestId("quera-error")).toHaveCount(0);
});

test("Ask Quera buttons on diagnostics and the summary open the chat with a question", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("sample-select").selectOption("missing-operand");
  await expect(page.getByTestId("analysis-outcome")).toHaveText("Analysis Failed");
  await page.getByTestId("ask-quera-diagnostic").first().click();
  await expect(panel(page)).toHaveAttribute("data-open", "true");
  await expect(page.getByTestId("quera-user-msg")).toContainText("QC2014");
  await expect(answers(page).first()).toContainText("FAILED during syntax", { timeout: 15_000 });
});

test("history persists across reloads, new chat clears it, Esc closes", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("quera-launcher").click();
  await page.getByRole("button", { name: "What can you help me with?" }).click();
  await expect(answers(page).first()).toContainText("Here is what I see", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeAttached(); // answer finished, so it has been saved
  await page.reload();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Control+/");
  await expect(panel(page)).toHaveAttribute("data-open", "true");
  await expect(answers(page).first()).toContainText("Here is what I see");
  await page.getByRole("button", { name: "Start a new chat" }).click();
  await expect(page.getByText("Hi, I'm Quera")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveAttribute("data-open", "false");
});

test("works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openPlayground(page);
  await page.getByTestId("quera-launcher").click();
  await page.getByTestId("quera-input").fill("hello");
  await page.keyboard.press("Enter");
  await expect(answers(page).first()).toContainText("Here is what I see", { timeout: 15_000 });
  const box = await panel(page).boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
