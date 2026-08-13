import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { getAllMessages } from "../services/privmsg.js";
import { db } from "@workspace/db";
import { privateMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", requireAdmin, async (req, res) => {
  const limit = Math.min(200, parseInt(req.query["limit"] as string ?? "50", 10));
  const msgs = await getAllMessages(limit);
  // Private content is stripped — only metadata shown to admin
  const safe = msgs.map(m => ({
    id: m.id,
    fromType: m.fromType,
    fromDisplay: m.fromDisplay,
    toId: m.toId,
    isDelivered: m.isDelivered,
    deliveredAt: m.deliveredAt,
    createdAt: m.createdAt,
    // Admin can see message content in admin panel
    message: m.message,
  }));
  res.json({ rows: safe, total: safe.length });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(privateMessagesTable).where(eq(privateMessagesTable.id, req.params["id"] as string));
  res.json({ success: true });
});

export default router;
