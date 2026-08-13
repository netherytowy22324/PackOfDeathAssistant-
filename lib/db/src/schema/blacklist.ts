import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const blacklistTable = pgTable("blacklist", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  nick: varchar("nick", { length: 64 }).notNull(),
  discordId: varchar("discord_id", { length: 32 }).notNull(),
  addedBy: varchar("added_by", { length: 64 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BlacklistEntry = typeof blacklistTable.$inferSelect;
