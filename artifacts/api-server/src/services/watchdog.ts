import { logger } from "../lib/logger.js";
import { getDiscordStatus, startDiscordBot } from "./discord-bot.js";
import { getMcBotStatus, connectMinecraft } from "./minecraft-bot.js";
import { connectRcon, getRconStatus } from "./rcon.js";
import { logEvent } from "./system-log.js";
import { cleanupExpiredCodes } from "./verification.js";
import { cleanupExpiredVacations, cleanupStaleFormAnswers, backfillTicketForms } from "./discord-bot.js";

const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
const BACKFILL_EVERY_N_TICKS = 10;   // every 10 × 30s = 5 minutes
const startTime = Date.now();

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

export function startWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);

  watchdogTimer = setInterval(async () => {
    tickCount++;
    await runHealthChecks();
    // Backfill ticket forms every 5 minutes (catches channels created while bot was offline)
    if (tickCount % BACKFILL_EVERY_N_TICKS === 0 && process.env["DISCORD_BOT_ENABLED"] !== "false") {
      backfillTicketForms().catch(() => {});
    }
  }, CHECK_INTERVAL_MS);

  logger.info("Watchdog started");
}

async function runHealthChecks(): Promise<void> {
  // Check Discord
  if (process.env["DISCORD_BOT_ENABLED"] !== "false") {
    const dc = getDiscordStatus();
    if (!dc.connected) {
      logger.warn("Watchdog: Discord not connected, attempting reconnect");
      await logEvent("warn", "watchdog", "Discord rozłączony — próba reconnect");
      startDiscordBot().catch(() => {});
    }
  }

  // Check Minecraft bot — skip if disabled or already reconnecting
  if (process.env["MC_BOT_ENABLED"] === "true") {
    const mc = getMcBotStatus();
    if (!mc.connected && !mc.reconnecting) {
      logger.warn("Watchdog: MC bot not connected, attempting reconnect");
      connectMinecraft();
    }
  }

  // Check RCON (only when MC bot is enabled)
  if (process.env["MC_BOT_ENABLED"] === "true") {
    const rcon = getRconStatus();
    if (!rcon.connected) {
      connectRcon().catch(() => {});
    }
  }

  // Cleanup expired verification codes (once a minute)
  await cleanupExpiredCodes().catch(() => {});

  // Cleanup stale pending form answers older than 7 days
  await cleanupStaleFormAnswers().catch(() => {});

  // Restore nicknames for vacations that have ended
  await cleanupExpiredVacations().catch(() => {});
}

export function getUptime(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}
