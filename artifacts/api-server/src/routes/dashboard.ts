import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { getDiscordStatus } from "../services/discord-bot.js";
import { getMcBotStatus } from "../services/minecraft-bot.js";
import { getRconStatus } from "../services/rcon.js";
import { bridgeService } from "../services/bridge.js";
import { getUptime } from "../services/watchdog.js";
import { db } from "@workspace/db";
import { verifiedUsersTable, errorLogsTable, privateMessagesTable } from "@workspace/db";
import { eq, count, and, desc } from "drizzle-orm";

const router = Router();

router.get("/stats", requireAdmin, async (req, res) => {
  const [
    verifiedCount,
    errorCount,
    pendingMsgsCount,
    recentErrors,
  ] = await Promise.all([
    db.select({ count: count() }).from(verifiedUsersTable).where(eq(verifiedUsersTable.isVerified, true)),
    db.select({ count: count() }).from(errorLogsTable).where(eq(errorLogsTable.level, "error")),
    db.select({ count: count() }).from(privateMessagesTable).where(eq(privateMessagesTable.isDelivered, false)),
    db.select().from(errorLogsTable).where(eq(errorLogsTable.level, "error")).orderBy(desc(errorLogsTable.createdAt)).limit(5),
  ]);

  res.json({
    discord: getDiscordStatus(),
    minecraft: getMcBotStatus(),
    rcon: getRconStatus(),
    sync: {
      enabled: bridgeService.isSyncEnabled(),
      maintenance: bridgeService.isMaintenanceMode(),
    },
    stats: {
      verifiedAccounts: verifiedCount[0]?.count ?? 0,
      totalErrors: errorCount[0]?.count ?? 0,
      pendingMessages: pendingMsgsCount[0]?.count ?? 0,
      uptimeSeconds: getUptime(),
    },
    recentErrors,
  });
});

export default router;
