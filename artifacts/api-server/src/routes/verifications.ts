import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.js";
import { db } from "@workspace/db";
import { verifiedUsersTable } from "@workspace/db";
import { eq, desc, like, or, count } from "drizzle-orm";
import { unlinkAccount } from "../services/verification.js";

const router = Router();

router.get("/", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(100, parseInt(req.query["limit"] as string ?? "20", 10));
  const search = req.query["search"] as string ?? "";
  const offset = (page - 1) * limit;

  const query = db.select().from(verifiedUsersTable);

  const rows = search
    ? await db.select().from(verifiedUsersTable)
        .where(or(like(verifiedUsersTable.mcNick, `%${search}%`), like(verifiedUsersTable.discordId, `%${search}%`)))
        .orderBy(desc(verifiedUsersTable.createdAt)).limit(limit).offset(offset)
    : await db.select().from(verifiedUsersTable)
        .orderBy(desc(verifiedUsersTable.createdAt)).limit(limit).offset(offset);

  const total = await db.select({ count: count() }).from(verifiedUsersTable);

  res.json({ rows, total: total[0]?.count ?? 0, page, limit });
});

router.get("/:id", requireAdmin, async (req, res) => {
  const id = req.params["id"] as string;
  const row = await db.select().from(verifiedUsersTable).where(eq(verifiedUsersTable.id, id)).limit(1);
  if (!row[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row[0]);
});

router.delete("/:discordId", requireAdmin, async (req, res) => {
  const discordId = req.params["discordId"] as string;
  const unlinked = await unlinkAccount(discordId);
  if (!unlinked) {
    res.status(404).json({ error: "Account not found or not verified" });
    return;
  }
  res.json({ success: true });
});

export default router;
