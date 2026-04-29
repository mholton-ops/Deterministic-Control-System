import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
    throw new Error(`GET ${path} failed with status ${response.status}`);
  }

  return response.json();
}

async function exportFixtures(): Promise<string | null> {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(FIXTURE_DIR, { recursive: true });

  for (const fixture of FIXTURE_PATHS) {
    const payload = await fetchJson(fixture.path);
    const path = resolve(FIXTURE_DIR, `${fixture.name}.json`);
    await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
  }

  const settlements = (await fetchJson("/workbench/settlements?mode=materialized")) as Array<{
    settlementId: string;
  }>;
  const firstSettlementId = settlements[0]?.settlementId ?? null;
  if (firstSettlementId) {
    const detail = await fetchJson(
      `/projections/settlement/${encodeURIComponent(firstSettlementId)}?mode=materialized`,
    );
    await writeFile(
      resolve(FIXTURE_DIR, "settlement-drilldown.json"),
      JSON.stringify(detail, null, 2),
      "utf-8",
    );
  }

  return firstSettlementId;
}

async function captureScreenshots(firstSettlementId: string | null): Promise<boolean> {
  let chromium: {
    launch: (options: { headless: boolean }) => Promise<{
      newPage: (options: { viewport: { width: number; height: number } }) => Promise<{
        goto: (url: string, options: { waitUntil: "networkidle" }) => Promise<void>;
        screenshot: (options: { path: string; fullPage: boolean }) => Promise<void>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  } | null = null;

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

  const pages: Array<{ path: string; file: string }> = [
    { path: "/", file: "overview.png" },
    { path: "/intake", file: "intake.png" },
    { path: "/replication", file: "replication-sync.png" },
    { path: "/custody", file: "custody.png" },
    { path: "/grading", file: "grading.png" },
    { path: "/analytics", file: "analytics.png" },
    { path: "/pricing-exposure", file: "pricing-exposure.png" },
    { path: "/customer", file: "customer-visibility.png" },
    { path: "/finance-ledger", file: "finance-ledger.png" },
    { path: "/reconciliation", file: "reconciliation.png" },
    { path: "/settlements", file: "settlements.png" },
    { path: "/audit", file: "audit.png" },
  ];

  if (firstSettlementId) {
    pages.push({
      path: `/settlements/${encodeURIComponent(firstSettlementId)}`,
      file: "settlement-detail.png",
    });
    pages.push({
      path: `/settlements/${encodeURIComponent(firstSettlementId)}/reconstruct`,
      file: "settlement-reconstruct.png",
    });
    pages.push({
      path: `/trace/settlement/${encodeURIComponent(firstSettlementId)}`,
      file: "trace-settlement.png",
    });
  }

  for (const item of pages) {
    await page.goto(`${WEB_BASE_URL}${item.path}`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: resolve(SCREENSHOT_DIR, item.file),
      fullPage: true,
    });
  }

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

  let apiStderr = "";
  let webStderr = "";
  apiProcess.stderr.on("data", (chunk) => {
    apiStderr += chunk.toString();
  });
  webProcess.stderr.on("data", (chunk) => {
    webStderr += chunk.toString();
  });

  try {
    await waitFor(`${API_BASE_URL}/health`, 25_000);
    await waitFor(`${WEB_BASE_URL}/`, 70_000);

    const firstSettlementId = await exportFixtures();
    const captured = await captureScreenshots(firstSettlementId);

    console.log(`Fixtures exported to ${FIXTURE_DIR}`);
    if (firstSettlementId) {
      console.log(`Included settlement drilldown for ${firstSettlementId}`);
    } else {
      console.log("No settlements found for drilldown fixture export.");
    }

    if (captured) {
      console.log(`Screenshots exported to ${SCREENSHOT_DIR}`);
    } else {
      console.log(
        "Playwright not installed. Skipped screenshots. Install with: npm i -D playwright && npx playwright install chromium",
      );
    }
  } catch (error) {
    if (apiStderr.trim().length > 0) {
      console.error(`API stderr tail:\n${apiStderr.slice(-1500)}`);
    }
    if (webStderr.trim().length > 0) {
      console.error(`Web stderr tail:\n${webStderr.slice(-1500)}`);
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
