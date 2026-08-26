import { logger } from "../lib/logger.js";
import { getDiscordStatus, startDiscordBot } from "./discord-bot.js";
import { logEvent } from "./system-log.js";
import { cleanupExpiredCodes } from "./verification.js";
import { cleanupExpiredVacations, cleanupStaleFormAnswers, backfillTicketForms } from "./discord-bot.js";

const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
const BACKFILL_EVERY_N_TICKS = 30;   // every 30 × 30s = 15 minutes
const startTime = Date.now();

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let healthCheckRunning = false;

export function startWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);

  watchdogTimer = setInterval(() => {
    tickCount++;

    // Never overlap slow database/Discord checks; overlapping runs compete with
    // command handlers and can create the delayed responses users see.
    if (!healthCheckRunning) {
      healthCheckRunning = true;
      runHealthChecks()
        .catch((err) => logger.warn({ err: String(err) }, "Watchdog health check failed"))
        .finally(() => { healthCheckRunning = false; });
    }

    // Backfill ticket forms every 15 minutes (catches channels created while bot was offline).
    if (tickCount % BACKFILL_EVERY_N_TICKS === 0 && process.env["DISCORD_BOT_ENABLED"] !== "false") {
      backfillTicketForms().catch((err) => logger.warn({ err: String(err) }, "Backfill ticket forms failed"));
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

  // Minecraft bot and RCON are intentionally disabled.
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
