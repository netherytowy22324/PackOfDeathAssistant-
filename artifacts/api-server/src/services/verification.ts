import { db } from "@workspace/db";
import {
  verificationCodesTable,
  verifiedUsersTable,
  type VerifiedUser,
} from "@workspace/db";
import { eq, and, gt, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "../lib/logger.js";
import { logEvent } from "./system-log.js";

const CODE_LENGTH = 32;
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Rate limiting: discordId → last request timestamp
const codeRateLimit = new Map<string, number>();
const RATE_LIMIT_MS = 30 * 1000; // 30 seconds between code requests

export async function generateVerificationCode(discordId: string): Promise<{ code: string; expiresAt: Date } | { error: string }> {
  // Rate limiting
  const lastRequest = codeRateLimit.get(discordId);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastRequest)) / 1000);
    return { error: `Poczekaj ${wait}s przed wygenerowaniem nowego kodu.` };
  }

  // Check if already verified
  const existing = await db.select().from(verifiedUsersTable)
    .where(and(eq(verifiedUsersTable.discordId, discordId), eq(verifiedUsersTable.isVerified, true)))
    .limit(1);
  if (existing.length > 0) {
    return { error: `Twoje konto jest już zweryfikowane (MC: **${existing[0]!.mcNick}**). Użyj \`=weryfikacja\` aby sprawdzić status.` };
  }

  // Invalidate any existing active codes for this user
  await db.update(verificationCodesTable)
    .set({ isUsed: true })
    .where(and(eq(verificationCodesTable.discordId, discordId), eq(verificationCodesTable.isUsed, false)));

  // Generate new code: 32 chars, lowercase letters + digits
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db.insert(verificationCodesTable).values({
    code,
    discordId,
    expiresAt,
    isUsed: false,
  });

  codeRateLimit.set(discordId, Date.now());
  await logEvent("info", "verification", `Wygenerowano kod weryfikacyjny dla Discord ID ${discordId}`);

  return { code, expiresAt };
}

export async function verifyCode(mcNick: string, code: string): Promise<{ success: boolean; discordId?: string; error?: string }> {
  const trimmedCode = code.trim().toLowerCase();

  // Validate code format
  if (trimmedCode.length !== CODE_LENGTH || !/^[a-z0-9]+$/.test(trimmedCode)) {
    return { success: false, error: "Nieprawidłowy format kodu." };
  }

  // Check if this MC nick is already linked to a Discord account
  const existingMc = await db.select().from(verifiedUsersTable)
    .where(and(eq(verifiedUsersTable.mcNick, mcNick), eq(verifiedUsersTable.isVerified, true)))
    .limit(1);
  if (existingMc.length > 0) {
    return { success: false, error: `Nick ${mcNick} jest już powiązany z kontem Discord. Użyj =weryfikacja w grze aby sprawdzić status.` };
  }

  // Find the code
  const codeRecord = await db.select().from(verificationCodesTable)
    .where(and(
      eq(verificationCodesTable.code, trimmedCode),
      eq(verificationCodesTable.isUsed, false),
      gt(verificationCodesTable.expiresAt, new Date()),
    ))
    .limit(1);

  if (codeRecord.length === 0) {
    return { success: false, error: "Kod jest nieprawidłowy, wygasł lub został już użyty. Wygeneruj nowy na Discordzie." };
  }

  const record = codeRecord[0]!;
  const discordId = record.discordId;

  // Check if Discord ID already has a linked account (prevent multi-linking)
  const existingDc = await db.select().from(verifiedUsersTable)
    .where(and(eq(verifiedUsersTable.discordId, discordId), eq(verifiedUsersTable.isVerified, true)))
    .limit(1);
  if (existingDc.length > 0) {
    return { success: false, error: "To konto Discord jest już zweryfikowane." };
  }

  // Mark code as used
  await db.update(verificationCodesTable)
    .set({ isUsed: true, usedAt: new Date(), usedByMcNick: mcNick })
    .where(eq(verificationCodesTable.id, record.id));

  // Create or update verified user record
  const existingUser = await db.select().from(verifiedUsersTable)
    .where(eq(verifiedUsersTable.discordId, discordId))
    .limit(1);

  if (existingUser.length > 0) {
    await db.update(verifiedUsersTable)
      .set({ mcNick, mcUuid: mcNick, isVerified: true, verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(verifiedUsersTable.discordId, discordId));
  } else {
    await db.insert(verifiedUsersTable).values({
      discordId,
      mcNick,
      mcUuid: mcNick,
      isVerified: true,
      verifiedAt: new Date(),
    });
  }

  await logEvent("info", "verification", `Zweryfikowano konto: MC=${mcNick}, Discord=${discordId}`);
  logger.info({ mcNick, discordId }, "Account verified");

  return { success: true, discordId };
}

export async function getVerificationStatusByDiscord(discordId: string): Promise<VerifiedUser | null> {
  const result = await db.select().from(verifiedUsersTable)
    .where(eq(verifiedUsersTable.discordId, discordId))
    .limit(1);
  return result[0] ?? null;
}

export async function getVerificationStatusByMcNick(mcNick: string): Promise<VerifiedUser | null> {
  const result = await db.select().from(verifiedUsersTable)
    .where(eq(verifiedUsersTable.mcNick, mcNick))
    .limit(1);
  return result[0] ?? null;
}

export async function unlinkAccount(discordId: string): Promise<boolean> {
  const existing = await db.select().from(verifiedUsersTable)
    .where(eq(verifiedUsersTable.discordId, discordId))
    .limit(1);
  if (existing.length === 0) return false;

  await db.update(verifiedUsersTable)
    .set({ isVerified: false, mcNick: null, mcUuid: null, verifiedAt: null, updatedAt: new Date() })
    .where(eq(verifiedUsersTable.discordId, discordId));

  await logEvent("info", "verification", `Odłączono konto Discord ID ${discordId}`);
  return true;
}

export async function manualVerify(discordId: string, mcNick: string): Promise<void> {
  const existing = await db.select().from(verifiedUsersTable)
    .where(eq(verifiedUsersTable.discordId, discordId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(verifiedUsersTable)
      .set({ mcNick, mcUuid: mcNick, isVerified: true, verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(verifiedUsersTable.discordId, discordId));
  } else {
    await db.insert(verifiedUsersTable).values({
      discordId,
      mcNick,
      mcUuid: mcNick,
      isVerified: true,
      verifiedAt: new Date(),
    });
  }

  await logEvent("info", "verification", `Ręczna weryfikacja: MC=${mcNick}, Discord=${discordId}`);
}

export async function changeNick(discordId: string, newNick: string): Promise<boolean> {
  const existing = await db.select().from(verifiedUsersTable)
    .where(eq(verifiedUsersTable.discordId, discordId))
    .limit(1);

  if (existing.length === 0) return false;

  await db.update(verifiedUsersTable)
    .set({ mcNick: newNick, mcUuid: newNick, updatedAt: new Date() })
    .where(eq(verifiedUsersTable.discordId, discordId));

  await logEvent("info", "verification", `Zmiana nicku: Discord=${discordId}, nowy nick=${newNick}`);
  return true;
}

export async function cleanupExpiredCodes(): Promise<void> {
  await db.update(verificationCodesTable)
    .set({ isUsed: true })
    .where(and(eq(verificationCodesTable.isUsed, false), lt(verificationCodesTable.expiresAt, new Date())));
}
