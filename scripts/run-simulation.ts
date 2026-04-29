import { spawnSync } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const result = spawnSync(npmExecutable, ["run", "simulate"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
