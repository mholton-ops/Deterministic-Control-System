import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = 39123;
const WEB_PORT = 39124;
const API_BASE_URL = `http://localhost:${API_PORT}`;
const WEB_BASE_URL = `http://localhost:${WEB_PORT}`;
const FIXTURE_DIR = resolve(ROOT_DIR, "docs", "fixtures", "latest");
const SCREENSHOT_DIR = resolve(ROOT_DIR, "docs", "screenshots", "latest");
const NPM_EXECUTABLE = process.platform === "win32" ? "npm.cmd" : "npm";
const EXPECTED_SCREENSHOT_FILES = [
  "analytics-mobile.png",
  "analytics.png",
  "custody.png",
  "customer-visibility.png",
  "finance-ledger.png",
  "grading.png",
  "intake.png",
  "overview.png",
  "pricing-exposure.png",
  "reconciliation.png",
  "replication-sync.png",
  "settlement-detail.png",
  "settlement-reconstruct.png",
  "trace-settlement.png",
  "truth-detail-panel.png",
] as const;

interface FixtureItem {
  readonly name: string;
  readonly path: string;
}

const FIXTURE_PATHS: FixtureItem[] = [
  { name: "operations-overview", path: "/projections/operations-overview?mode=materialized" },
  { name: "intake", path: "/workbench/intake?mode=materialized" },
  { name: "replication-sync", path: "/workbench/replication-sync" },
  { name: "custody", path: "/workbench/custody?mode=materialized" },
  { name: "grading", path: "/workbench/grading?mode=materialized" },
  { name: "smart-library-detail", path: "/workbench/smart-library-detail" },
  { name: "analytics", path: "/workbench/analytics?mode=materialized" },
  { name: "pricing-exposure", path: "/workbench/pricing-exposure?mode=materialized" },
  { name: "customer-visibility", path: "/customer/visibility" },
  { name: "funding-control", path: "/workbench/funding-control" },
  { name: "ledger-trace", path: "/projections/ledger-trace?mode=materialized" },
  { name: "reconciliation", path: "/workbench/reconciliation?mode=materialized" },
  { name: "settlements", path: "/workbench/settlements?mode=materialized" },
  { name: "evidence", path: "/workbench/evidence?mode=materialized" },
  { name: "transactions", path: "/workbench/transactions?mode=materialized&limit=200" },
];
const EXPECTED_FIXTURE_FILES = [
  ...FIXTURE_PATHS.map((fixture) => `${fixture.name}.json`),
  "settlement-drilldown.json",
].sort();

async function assertExactArtifactSet(directory: string, expectedFiles: readonly string[]): Promise<void> {
  const actualFiles = (await readdir(directory)).sort();
  const expected = [...expectedFiles].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expected)) {
    throw new Error(
      `Reviewer artifact set mismatch in ${directory}. Expected ${expected.join(", ")}; received ${actualFiles.join(", ")}.`,
    );
  }
}

function resolveCommand(command: string, args: string[]): { executable: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", `${command} ${args.join(" ")}`],
    };
  }

  return {
    executable: command,
    args,
  };
}

function runCommand(command: string, args: string[]): void {
  const resolved = resolveCommand(command, args);
  const result = spawnSync(resolved.executable, resolved.args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });

  if ((result.status ?? 1) !== 0) {
    const errorText = result.error instanceof Error ? ` | ${result.error.message}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${errorText}`);
  }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError = "unknown";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }

      lastError = `${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
  }

  throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // no-op
    }
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${path} failed with status ${response.status}: ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function exportFixtures(): Promise<string> {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(FIXTURE_DIR, { recursive: true });

  for (const fixture of FIXTURE_PATHS) {
    const payload = await fetchJson(fixture.path);
    const path = resolve(FIXTURE_DIR, `${fixture.name}.json`);
    await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
  }

  const settlements = (await fetchJson("/workbench/settlements?mode=materialized")) as Array<{
    settlementId: string;
    status: string;
    finalValueUsd: string | null;
    finalizedAt: string | null;
    invoiceCount: number;
    chainCompleteness: {
      complete: number;
      total: number;
      missing: readonly string[];
    };
  }>;
  const reviewerSettlement = settlements.find(
    (settlement) =>
      settlement.status === "finalized" &&
      settlement.finalValueUsd !== null &&
      settlement.finalizedAt !== null &&
      settlement.invoiceCount > 0 &&
      settlement.chainCompleteness.total > 0 &&
      settlement.chainCompleteness.complete === settlement.chainCompleteness.total &&
      settlement.chainCompleteness.missing.length === 0,
  );
  if (!reviewerSettlement) {
    throw new Error("Reviewer artifacts require a finalized settlement with a complete proof chain and invoice.");
  }

  const detail = await fetchJson(
    `/projections/settlement/${encodeURIComponent(reviewerSettlement.settlementId)}?mode=materialized`,
  );
  await writeFile(
    resolve(FIXTURE_DIR, "settlement-drilldown.json"),
    JSON.stringify(detail, null, 2),
    "utf-8",
  );
  await assertExactArtifactSet(FIXTURE_DIR, EXPECTED_FIXTURE_FILES);

  return reviewerSettlement.settlementId;
}

async function captureScreenshots(reviewerSettlementId: string): Promise<boolean> {
  let chromium: (typeof import("playwright"))["chromium"] | null = null;

  try {
    const playwrightModule = await import("playwright");
    chromium = playwrightModule.chromium;
  } catch {
    return false;
  }

  await rm(SCREENSHOT_DIR, { recursive: true, force: true });
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    browserErrors.push(`page: ${error.message}`);
  });

  const pages: Array<{ path: string; file: string; heading: string }> = [
    { path: "/", file: "overview.png", heading: "Operations Command Surface" },
    { path: "/intake", file: "intake.png", heading: "Field Intake" },
    { path: "/replication", file: "replication-sync.png", heading: "Replication / Sync" },
    { path: "/custody", file: "custody.png", heading: "Inventory and Custody" },
    { path: "/grading", file: "grading.png", heading: "Grading Workbench" },
    { path: "/analytics", file: "analytics.png", heading: "Analytical Results" },
    { path: "/pricing-exposure", file: "pricing-exposure.png", heading: "Pricing and Exposure" },
    { path: "/customer", file: "customer-visibility.png", heading: "Customer Visibility" },
    { path: "/finance-ledger", file: "finance-ledger.png", heading: "Financial Ledger" },
    { path: "/reconciliation", file: "reconciliation.png", heading: "Reconciliation" },
  ];

  pages.push({
    path: `/settlements/${encodeURIComponent(reviewerSettlementId)}`,
    file: "settlement-detail.png",
    heading: "Settlement Detail",
  });
  pages.push({
    path: `/settlements/${encodeURIComponent(reviewerSettlementId)}/reconstruct`,
    file: "settlement-reconstruct.png",
    heading: "Settlement Reconstruction",
  });
  pages.push({
    path: `/trace/settlement/${encodeURIComponent(reviewerSettlementId)}`,
    file: "trace-settlement.png",
    heading: "Trace View",
  });

  for (const item of pages) {
    await page.goto(`${WEB_BASE_URL}${item.path}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: item.heading, exact: true, level: 1 }).waitFor({ state: "visible" });
    if ((await page.getByText("Unable to query control API:", { exact: false }).count()) > 0) {
      throw new Error(`Reviewer route ${item.path} rendered an API failure state.`);
    }
    await page.screenshot({
      path: resolve(SCREENSHOT_DIR, item.file),
      fullPage: true,
    });

    if (item.path === "/") {
      await page.getByRole("button", { name: "Detail", exact: true }).first().click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
      if ((await page.getByRole("button", { name: "Retry", exact: true }).count()) > 0) {
        throw new Error("Truth detail panel loaded an error state.");
      }
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
      await page.screenshot({
        path: resolve(SCREENSHOT_DIR, "truth-detail-panel.png"),
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB_BASE_URL}/analytics`, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Analytical Results", exact: true, level: 1 })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Detail", exact: true }).first().waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Trace", exact: true }).first().waitFor({ state: "visible" });
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "analytics-mobile.png"),
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`Browser verification reported errors:\n${browserErrors.join("\n")}`);
  }

  await assertExactArtifactSet(SCREENSHOT_DIR, EXPECTED_SCREENSHOT_FILES);

  await page.close();
  await browser.close();
  return true;
}

async function main(): Promise<void> {
  console.log("Preparing deterministic data...");
  runCommand(NPM_EXECUTABLE, ["run", "db:reset"]);
  runCommand(NPM_EXECUTABLE, ["run", "db:seed"]);
  runCommand(NPM_EXECUTABLE, ["run", "simulate"]);
  runCommand(NPM_EXECUTABLE, ["run", "projections:worker:once"]);

  console.log("Starting API and web servers...");
  const apiCommand = resolveCommand(NPM_EXECUTABLE, ["run", "dev:api"]);
  const apiProcess = spawn(apiCommand.executable, apiCommand.args, {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(API_PORT) },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const webCommand = resolveCommand(NPM_EXECUTABLE, [
    "run",
    "--workspace",
    "@dcs/operator-web",
    "dev",
    "--",
    "--port",
    String(WEB_PORT),
  ]);
  const webProcess = spawn(webCommand.executable, webCommand.args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      DCS_API_BASE_URL: API_BASE_URL,
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let apiStdout = "";
  let apiStderr = "";
  let webStdout = "";
  let webStderr = "";
  apiProcess.stdout.on("data", (chunk) => {
    apiStdout += chunk.toString();
  });
  apiProcess.stderr.on("data", (chunk) => {
    apiStderr += chunk.toString();
  });
  webProcess.stdout.on("data", (chunk) => {
    webStdout += chunk.toString();
  });
  webProcess.stderr.on("data", (chunk) => {
    webStderr += chunk.toString();
  });

  try {
    await waitFor(`${API_BASE_URL}/health`, 25_000);
    await waitFor(`${WEB_BASE_URL}/`, 70_000);

    const reviewerSettlementId = await exportFixtures();
    const captured = await captureScreenshots(reviewerSettlementId);

    console.log(`Fixtures exported to ${FIXTURE_DIR}`);
    console.log(`Included finalized settlement drilldown for ${reviewerSettlementId}`);

    if (captured) {
      console.log(`Screenshots exported to ${SCREENSHOT_DIR}`);
    } else {
      console.log(
        "Playwright not installed. Skipped screenshots. Install with: npm i -D playwright && npx playwright install chromium",
      );
    }
  } catch (error) {
    if (apiStdout.trim().length > 0) {
      console.error(`API stdout tail:\n${apiStdout.slice(-2500)}`);
    }
    if (apiStderr.trim().length > 0) {
      console.error(`API stderr tail:\n${apiStderr.slice(-2500)}`);
    }
    if (webStdout.trim().length > 0) {
      console.error(`Web stdout tail:\n${webStdout.slice(-2500)}`);
    }
    if (webStderr.trim().length > 0) {
      console.error(`Web stderr tail:\n${webStderr.slice(-2500)}`);
    }
    throw error;
  } finally {
    killProcessTree(apiProcess.pid);
    killProcessTree(webProcess.pid);
  }
}

main().catch((error) => {
  console.error("Artifact generation failed:", error);
  process.exit(1);
});
