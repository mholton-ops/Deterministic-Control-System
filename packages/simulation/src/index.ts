import { runDeterministicScenario } from "./scenario";

runDeterministicScenario()
  .then(() => {
    console.log("Deterministic scenario complete.");
  })
  .catch((error) => {
    console.error("Deterministic scenario failed:", error);
    process.exit(1);
  });
