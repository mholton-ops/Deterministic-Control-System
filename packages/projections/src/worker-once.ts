import { createDb, createPool } from "@dcs/db";

import { runProjectionWorkerOnce } from "./worker";

async function main(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    const result = await runProjectionWorkerOnce(db);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Projection worker failed:", error);
  process.exit(1);
});
