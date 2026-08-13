import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { getDiscordStatus } from "../services/discord-bot.js";
import { getMcBotStatus } from "../services/minecraft-bot.js";
import { getRconStatus } from "../services/rcon.js";
import { bridgeService } from "../services/bridge.js";
import { getUptime } from "../services/watchdog.js";

const router = Router();

router.get("/", requireAdmin, (req, res) => {
  res.json({
    discord: getDiscordStatus(),
    minecraft: getMcBotStatus(),
    rcon: getRconStatus(),
    sync: {
      enabled: bridgeService.isSyncEnabled(),
      maintenance: bridgeService.isMaintenanceMode(),
    },
    uptime: getUptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
