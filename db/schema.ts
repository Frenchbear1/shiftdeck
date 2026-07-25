import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const calendarFeeds = sqliteTable("calendar_feeds", {
  token: text("token").primaryKey(),
  calendarName: text("calendar_name").notNull(),
  ics: text("ics").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
