import { createServer } from "node:http";
import { logger } from "./lib/logger.js";
import { startDiscordBot } from "./services/discord-bot.js";
import { startWatchdog } from "./services/watchdog.js";

function startHealthServer(): void {
  const port = Number(process.env["PORT"] ?? 10000);
  const server = createServer((request, response) => {
    if (request.url === "/api/healthz" || request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "packsmp-discord-api" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Health server listening");
  });
}

async function main(): Promise<void> {
  startHealthServer();

  if (process.env["DISCORD_BOT_ENABLED"] !== "false") {
    await startDiscordBot();
  }

  startWatchdog();
  logger.info("API server services started");
}

main().catch((err) => {
  logger.error({ err: String(err) }, "Fatal API server startup error");
  process.exitCode = 1;
});
