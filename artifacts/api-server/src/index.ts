import { logger } from "./lib/logger.js";
import { startDiscordBot } from "./services/discord-bot.js";
import { startWatchdog } from "./services/watchdog.js";

async function main(): Promise<void> {
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
