import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startDiscordBot } from "./services/discord-bot.js";
import { connectMinecraft, setDiscordRef } from "./services/minecraft-bot.js";
import { connectRcon } from "./services/rcon.js";
import { startWatchdog } from "./services/watchdog.js";
import { getDiscordClient } from "./services/discord-bot.js";
import { db } from "@workspace/db";
import { systemConfigTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const CHAT_CHANNEL_ID = process.env["DISCORD_CHAT_CHANNEL_ID"] ?? "";

async function seedAdminPassword(): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, "admin_password_hash"))
      .limit(1);

    if (!existing[0]) {
      const hash = await bcrypt.hash("12122012", 12);
      await db.insert(systemConfigTable).values({
        key: "admin_password_hash",
        value: hash,
      });
      logger.info("Admin password seeded (default: 12122012)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed admin password");
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed default admin password if not set
  await seedAdminPassword();

  // Only the production instance owns the Discord gateway session.
  // The dev API must not connect with the same token or interactions get acknowledged twice.
  const discordEnabled = process.env["DISCORD_BOT_ENABLED"] !== "false";
  if (discordEnabled) {
    logger.info("Starting Discord bot...");
    await startDiscordBot();
  } else {
    logger.info("Discord bot disabled (DISCORD_BOT_ENABLED=false)");
  }

  // Wait briefly for Discord to be ready before connecting MC (so we can pass the client ref)
  await new Promise(r => setTimeout(r, 3000));

  // Wire up MC bot → Discord relay
  const dcClient = getDiscordClient();
  if (dcClient) {
    setDiscordRef(dcClient, CHAT_CHANNEL_ID);
  }

  // Connect Minecraft bot (disabled in dev to avoid duplicate_login with production)
  const mcEnabled = process.env["MC_BOT_ENABLED"] !== "false";
  if (mcEnabled) {
    logger.info("Starting Minecraft bot...");
    connectMinecraft();

    // Connect RCON
    logger.info("Connecting RCON...");
    connectRcon().catch(() => {});
  } else {
    logger.info("MC bot disabled (MC_BOT_ENABLED=false) — skipping Minecraft & RCON");
  }

  // Start watchdog
  startWatchdog();

  logger.info("PackSMP Bridge fully initialized");
});

// Never let a stray promise rejection or exception kill the bridge
process.on("unhandledRejection", (err) => {
  logger.error({ err: String(err) }, "Unhandled promise rejection (ignored)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err: String(err) }, "Uncaught exception (ignored)");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  process.exit(0);
});
