import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { startCronJobs } from "./jobs/cron";

app.listen(env.port, () => {
  logger.info(`Servidor escuchando en http://localhost:${env.port}`);
  logger.info(`Swagger docs en http://localhost:${env.port}/api/docs`);
  startCronJobs();
});
