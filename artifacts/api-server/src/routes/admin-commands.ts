import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { bridgeService } from "../services/bridge.js";
import { restartMinecraft, connectMinecraft } from "../services/minecraft-bot.js";
import { restartDiscordBot } from "../services/discord-bot.js";
import { connectRcon, sendRconCommand } from "../services/rcon.js";
import { logEvent } from "../services/system-log.js";

const router = Router();

router.post("/sync-restart", requireAdmin, async (req, res) => {
  bridgeService.setSyncEnabled(true);
  bridgeService.setMaintenance(false);
  await logEvent("info", "admin", "Sync zrestartowany przez admina");
  res.json({ success: true, message: "Synchronizacja zrestartowana" });
});

router.post("/sync-stop", requireAdmin, async (req, res) => {
  bridgeService.setSyncEnabled(false);
  await logEvent("info", "admin", "Sync zatrzymany przez admina");
  res.json({ success: true, message: "Synchronizacja zatrzymana" });
});

router.post("/bot-restart-mc", requireAdmin, async (req, res) => {
  await logEvent("info", "admin", "Restart bota MC przez admina");
  restartMinecraft();
  res.json({ success: true, message: "Bot Minecraft jest restartowany" });
});

router.post("/bot-reconnect-discord", requireAdmin, async (req, res) => {
  await logEvent("info", "admin", "Reconnect Discord bota przez admina");
  restartDiscordBot().catch(() => {});
  res.json({ success: true, message: "Discord bot jest restartowany" });
});

router.post("/rcon-reconnect", requireAdmin, async (req, res) => {
  await connectRcon();
  res.json({ success: true, message: "RCON reconnect zainicjowany" });
});

router.post("/maintenance", requireAdmin, async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  const state = enabled ?? !bridgeService.isMaintenanceMode();
  bridgeService.setMaintenance(state);
  bridgeService.setSyncEnabled(!state);
  await logEvent("info", "admin", `Tryb konserwacji: ${state ? "włączony" : "wyłączony"}`);
  res.json({ success: true, maintenance: state });
});

router.post("/rcon-command", requireAdmin, async (req, res) => {
  const { command } = req.body as { command?: string };
  if (!command) { res.status(400).json({ error: "command required" }); return; }
  const result = await sendRconCommand(command);
  res.json({ success: result !== null, output: result });
});

export default router;
