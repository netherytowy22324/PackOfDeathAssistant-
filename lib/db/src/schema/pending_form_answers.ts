import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Stores partial multi-page ticket form answers between page submissions.
 * Using the database instead of an in-memory Map means bot restarts don't
 * lose data — the user can still complete the remaining pages after a reconnect.
 *
 * key = `${discordUserId}:${ticketType}`
 * answers = JSON-serialised Record<fieldId, string>
 */
export const pendingFormAnswersTable = pgTable("pending_form_answers", {
  key: varchar("key", { length: 128 }).primaryKey(),
  ticketType: varchar("ticket_type", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  answers: text("answers").notNull().default("{}"), // JSON
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PendingFormAnswers = typeof pendingFormAnswersTable.$inferSelect;
