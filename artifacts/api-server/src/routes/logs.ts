import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { getRecentLogs, getRecentChats } from "../services/system-log.js";
import { db } from "@workspace/db";
import { errorLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/system", requireAdmin, async (req, res) => {
  const limit = Math.min(500, parseInt(req.query["limit"] as string ?? "100", 10));
  const level = req.query["level"] as string | undefined;
  const logs = await getRecentLogs(limit);
  const filtered = level ? logs.filter(l => l.level === level) : logs;
  res.json({ rows: filtered, total: filtered.length });
});

router.get("/chat", requireAdmin, async (req, res) => {
  const limit = Math.min(500, parseInt(req.query["limit"] as string ?? "100", 10));
  const source = req.query["source"] as string | undefined;
  const chats = await getRecentChats(limit);
  const filtered = source ? chats.filter(c => c.source === source) : chats;
  res.json({ rows: filtered, total: filtered.length });
});

router.delete("/system", requireAdmin, async (req, res) => {
  await db.delete(errorLogsTable);
  res.json({ success: true });
});

export default router;
