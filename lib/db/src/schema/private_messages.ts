import { pgTable, text, timestamp, boolean, varchar } from "drizzle-orm/pg-core";

export const privateMessagesTable = pgTable("private_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromType: varchar("from_type", { length: 2 }).notNull(), // 'mc' | 'dc'
  fromId: varchar("from_id", { length: 64 }).notNull(),   // MC nick or Discord ID
  fromDisplay: varchar("from_display", { length: 64 }).notNull(), // display name
  toId: varchar("to_id", { length: 64 }).notNull(),         // MC nick or Discord ID
  message: text("message").notNull(),
  isDelivered: boolean("is_delivered").default(false).notNull(),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PrivateMessage = typeof privateMessagesTable.$inferSelect;
