import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  state: text('state').notNull().default('active'), created: integer('created').notNull(),
});
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), invite: text('invite').notNull().unique(),
  document: text('document').notNull(), version: integer('version').notNull().default(0),
  created: integer('created').notNull(),
});
export const limits = sqliteTable('limits', {
  id: text('id').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull(),
});
