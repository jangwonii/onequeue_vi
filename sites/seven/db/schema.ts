import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});
export const challenges = sqliteTable('challenges', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  invite: text('invite').notNull().unique(),
  document: text('document').notNull(),
  version: integer('version').notNull().default(0),
  created: integer('created').notNull(),
}, table => [index('challenges_owner').on(table.ownerId)]);
export const limits = sqliteTable('limits', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expires: integer('expires').notNull(),
});
