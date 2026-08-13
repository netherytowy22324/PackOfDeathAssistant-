import { pgTable, text, timestamp, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const verifiedUsersTable = pgTable("verified_users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  discordId: varchar("discord_id", { length: 32 }).notNull().unique(),
  mcUuid: varchar("mc_uuid", { length: 64 }).unique(),
  mcNick: varchar("mc_nick", { length: 32 }),
  discordNickBefore: varchar("discord_nick_before", { length: 64 }),
  verifiedAt: timestamp("verified_at"),
  isVerified: boolean("is_verified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVerifiedUserSchema = createInsertSchema(verifiedUsersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVerifiedUser = z.infer<typeof insertVerifiedUserSchema>;
export type VerifiedUser = typeof verifiedUsersTable.$inferSelect;
