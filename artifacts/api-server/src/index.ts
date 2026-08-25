import { logger } from "./lib/logger.js";
import { startDiscordBot } from "./services/discord-bot.js";
import { connectMinecraft } from "./services/minecraft-bot.js";
import { connectRcon } from "./services/rcon.js";
import { startWatchdog } from "./services/watchdog.js";

async function main(): Promise<void> {
  if (process.env["DISCORD_BOT_ENABLED"] !== "false") {
    await startDiscordBot();
  }

  if (process.env["MC_BOT_ENABLED"] === "true") {
    connectMinecraft();
    await connectRcon();
  }

  startWatchdog();
  logger.info("API server services started");
}

main().catch((err) => {
  logger.error({ err: String(err) }, "Fatal API server startup error");
  process.exitCode = 1;
});
