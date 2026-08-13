import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { db } from "@workspace/db";
import { systemConfigTable } from "@workspace/db";
import { eq, not, inArray } from "drizzle-orm";
import { bridgeService } from "../services/bridge.js";

const router = Router();

// Keys that should not be exposed (security)
const HIDDEN_KEYS = ["admin_password_hash"];

router.get("/", requireAdmin, async (req, res) => {
  const rows = await db.select().from(systemConfigTable);
  const safe = rows.filter(r => !HIDDEN_KEYS.includes(r.key));
  res.json({
    db: safe,
    env: {
      MC_HOST: process.env["MC_HOST"],
      MC_PORT: process.env["MC_PORT"],
      RCON_PORT: process.env["RCON_PORT"],
      MC_BOT_NICK: process.env["MC_BOT_NICK"],
      MC_MODE: process.env["MC_MODE"],
      DISCORD_GUILD_ID: process.env["DISCORD_GUILD_ID"],
      DISCORD_CHAT_CHANNEL_ID: process.env["DISCORD_CHAT_CHANNEL_ID"],
      DISCORD_VERIFY_ROLE_ID: process.env["DISCORD_VERIFY_ROLE_ID"],
    },
    runtime: {
      syncEnabled: bridgeService.isSyncEnabled(),
      maintenanceMode: bridgeService.isMaintenanceMode(),
    },
  });
});

router.put("/", requireAdmin, async (req, res) => {
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key || value === undefined) {
    res.status(400).json({ error: "key and value required" });
    return;
  }
  if (HIDDEN_KEYS.includes(key)) {
    res.status(403).json({ error: "Cannot modify this key via API" });
    return;
  }

  await db.insert(systemConfigTable).values({ key, value }).onConflictDoUpdate({
    target: systemConfigTable.key,
    set: { value, updatedAt: new Date() },
  });

  // Handle runtime config changes
  if (key === "sync_enabled") {
    bridgeService.setSyncEnabled(value === "true");
  } else if (key === "maintenance_mode") {
    bridgeService.setMaintenance(value === "true");
  }

  res.json({ success: true });
});

export default router;
