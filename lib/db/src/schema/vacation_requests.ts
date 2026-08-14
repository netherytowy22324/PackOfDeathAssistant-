import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Active Discord vacation requests.
 * One active vacation is stored per Discord user so the watchdog can restore
 * the nickname after the end date, including after a bot restart.
 */
export const vacationRequestsTable = pgTable("vacation_requests", {
  userId: varchar("user_id", { length: 32 }).primaryKey(),
  mcNick: varchar("mc_nick", { length: 100 }).notNull(),
  reason: text("reason").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VacationRequest = typeof vacationRequestsTable.$inferSelect;