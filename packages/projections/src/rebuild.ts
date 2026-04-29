import { createDb, createPool } from "@dcs/db";
import { rebuildMaterializedProjections } from "./materializer";

export async function rebuildProjectionsCli(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    const summary = await rebuildMaterializedProjections(db);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

rebuildProjectionsCli().catch((error) => {
  console.error("Projection rebuild failed:", error);
  process.exit(1);
});
