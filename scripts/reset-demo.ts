import { spawnSync } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const reset = spawnSync(npmExecutable, ["run", "db:reset"], {
  stdio: "inherit",
});

if ((reset.status ?? 1) !== 0) {
  process.exit(reset.status ?? 1);
}

const seed = spawnSync(npmExecutable, ["run", "db:seed"], {
  stdio: "inherit",
});

process.exit(seed.status ?? 1);
