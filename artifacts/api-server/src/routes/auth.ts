import { Router } from "express";
import bcrypt from "bcryptjs";
import { signAdminToken, requireAdmin } from "../middlewares/auth.js";
import { loginRateLimiter } from "../middlewares/rate-limiter.js";
import { db } from "@workspace/db";
import { systemConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logEvent } from "../services/system-log.js";

const router = Router();

const DEFAULT_PASSWORD = "12122012";
const CONFIG_KEY = "admin_password_hash";

async function getPasswordHash(): Promise<string> {
  const row = await db.select().from(systemConfigTable).where(eq(systemConfigTable.key, CONFIG_KEY)).limit(1);
  if (row[0]) return row[0].value;
  // First run: hash default password and store it
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  await db.insert(systemConfigTable).values({ key: CONFIG_KEY, value: hash }).onConflictDoUpdate({
    target: systemConfigTable.key,
    set: { value: hash },
  });
  return hash;
}

router.post("/login", loginRateLimiter, async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "Password required" });
    return;
  }

  const hash = await getPasswordHash();
  const valid = await bcrypt.compare(password, hash);

  if (!valid) {
    await logEvent("warn", "auth", `Nieudana próba logowania z ${req.ip}`);
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const token = signAdminToken();
  await logEvent("info", "auth", `Zalogowano do panelu admin z ${req.ip}`);
  res.json({ token, expiresIn: "8h" });
});

router.post("/logout", requireAdmin, (req, res) => {
  // JWT is stateless — client just discards the token
  res.json({ success: true });
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ role: "admin", authenticated: true });
});

router.put("/password", requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const hash = await getPasswordHash();
  const valid = await bcrypt.compare(currentPassword, hash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.insert(systemConfigTable).values({ key: CONFIG_KEY, value: newHash }).onConflictDoUpdate({
    target: systemConfigTable.key,
    set: { value: newHash },
  });

  await logEvent("info", "auth", "Zmieniono hasło panelu admin");
  res.json({ success: true });
});

export default router;
