import { pgTable, text, timestamp, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const verificationCodesTable = pgTable("verification_codes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: varchar("code", { length: 32 }).notNull().unique(),
  discordId: varchar("discord_id", { length: 32 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedByMcNick: varchar("used_by_mc_nick", { length: 32 }),
  isUsed: boolean("is_used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVerificationCodeSchema = createInsertSchema(verificationCodesTable).omit({ id: true, createdAt: true });
export type InsertVerificationCode = z.infer<typeof insertVerificationCodeSchema>;
export type VerificationCode = typeof verificationCodesTable.$inferSelect;
