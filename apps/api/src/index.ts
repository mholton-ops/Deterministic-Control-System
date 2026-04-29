import { buildServer } from "./server";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer();

app
  .listen({ port, host })
  .then(() => {
    app.log.info({ port, host }, "DCS control API listening");
  })
  .catch((error) => {
    app.log.error({ err: error }, "API startup failure");
    process.exit(1);
  });
