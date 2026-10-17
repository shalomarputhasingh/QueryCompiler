import { type Page, expect, test } from "@playwright/test";

async function openPlayground(page: Page) {
  await page.goto("/playground");
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
}

async function setEditorText(page: Page, text: string) {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

const outcome = (page: Page) => page.getByTestId("analysis-outcome");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("loads a sample query, analyzes it and inspects every phase, then executes", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await openPlayground(page);

  // 2. Load a sample query (auto-analyzes).
  await page.getByTestId("sample-select").selectOption("join");
  await expect(outcome(page)).toHaveText("Analysis Successful");

  // 4. Tokens
  await page.getByRole("tab", { name: "Tokens" }).click();
  await expect(page.getByRole("cell", { name: "INNER", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^KEYWORD/ }).click();
  await expect(page.getByRole("cell", { name: "KEYWORD" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "IDENTIFIER" })).toHaveCount(0);

  // Syntax tree: real nodes from the parser, plus the textual form.
  await page.getByRole("tab", { name: "Syntax Tree" }).click();
  await expect(page.getByRole("img", { name: "Abstract syntax tree" })).toBeVisible();
  await page.getByRole("button", { name: "Text" }).click();
  await expect(page.getByText("SelectStatement SELECT")).toBeVisible();

  // Symbol table
  await page.getByRole("tab", { name: "Symbol Table" }).click();
  await page.getByLabel("Search symbols").fill("budget");
  await expect(page.getByRole("cell", { name: "d.budget" }).first()).toBeVisible();

  // 5. Relational algebra + optimization
  await page.getByRole("tab", { name: "Intermediate Representation" }).click();
  await expect(page.getByText(/π_\{s\.name, d\.name AS department\}/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Query Optimization" }).click();
  await expect(page.getByTestId("optimization-step").first()).toContainText("Selection pushdown");
  await expect(page.getByText("not a measured speed-up")).toBeVisible();

  // 6-7. Execute and confirm results
  await page.getByTestId("execute").click();
  await expect(page.getByTestId("execution-result")).toBeVisible();
  const rows = Number(await page.getByTestId("row-count").innerText());
  expect(rows).toBeGreaterThan(0);
  await expect(page.getByRole("columnheader", { name: "department" })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("reports a syntax error with its location and blocks execution", async ({ page }) => {
  await openPlayground(page);
  await setEditorText(page, "SELECT name FROM students WHERE marks >");
  await page.getByTestId("analyze").click();
  await expect(outcome(page)).toHaveText("Analysis Failed");
  await expect(page.getByText("Missing operand after '>'").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /line 1, column/ }).first()).toBeVisible();
  // The editor shows a marker at the error position.
  await expect(page.locator(".squiggly-error").first()).toBeVisible();

  await page.getByTestId("execute").click();
  await expect(page.getByTestId("execution-error")).toContainText("did not pass compilation");
});

test("reports semantic errors with suggestions for each invalid sample", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("sample-select").selectOption("bad-table");
  await expect(outcome(page)).toHaveText("Analysis Failed");
  await expect(page.getByText("Unknown table 'student'").first()).toBeVisible();
  await expect(page.getByText("Did you mean 'students'?").first()).toBeVisible();

  await page.getByTestId("sample-select").selectOption("unterminated-string");
  await expect(page.getByText("Unterminated string literal").first()).toBeVisible();

  await page.getByTestId("sample-select").selectOption("bad-column");
  await expect(page.getByText("Unknown column 'nam'").first()).toBeVisible();
});

test("keyboard shortcut analyzes; typing marks the analysis as edited", async ({ page }) => {
  await openPlayground(page);
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(outcome(page)).toHaveText("Analysis Successful");
  await page.keyboard.insertText(" ");
  await expect(page.getByTestId("compiler-status")).toContainText("(edited)");
});

test("navigation, examples, history, schema and documentation all work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Example Queries" }).first().click();
  await expect(page.getByTestId("example-where")).toBeVisible();
  await page.getByTestId("example-where").getByRole("button", { name: /Load & analyze/ }).click();
  await expect(page).toHaveURL(/\/playground/);
  await expect(outcome(page)).toHaveText("Analysis Successful");

  await page.getByRole("link", { name: "Query History" }).click();
  await expect(page.getByTestId("history-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "Restore & analyze" }).click();
  await expect(page).toHaveURL(/\/playground/);

  await page.getByRole("link", { name: "Compiler Pipeline" }).click();
  await expect(page.getByTestId("learn-syntax")).toContainText("recursive-descent");

  await page.getByRole("link", { name: "Schema Explorer" }).click();
  await expect(page.getByTestId("table-students")).toContainText("department_id");
  await expect(page.getByTestId("table-students")).toContainText("departments.id");

  await page.getByRole("link", { name: "Documentation" }).click();
  await expect(page.getByRole("heading", { name: "Supported SQL" })).toBeVisible();

  await page.getByRole("link", { name: "Query History" }).click();
  await page.getByRole("button", { name: "Clear history" }).click();
  await expect(page.getByText("No history yet")).toBeVisible();
});

test("theme toggle and Run All", async ({ page }) => {
  await openPlayground(page);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByTestId("run-all").click();
  await expect(page.getByTestId("execution-result")).toBeVisible();
});

test("usable on a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openPlayground(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Schema Explorer" }).click();
  await expect(page.getByTestId("table-students")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
