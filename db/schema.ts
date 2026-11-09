import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const profiles=sqliteTable('profiles',{id:text('id').primaryKey(),name:text('name').notNull().unique(),away:text('away').notNull().default(''),seen:integer('seen').notNull()});
export const buddies=sqliteTable('buddies',{owner:text('owner').notNull(),buddy:text('buddy').notNull() },t=>[primaryKey({columns:[t.owner,t.buddy]})]);
export const messages=sqliteTable('messages',{id:text('id').primaryKey(),sender:text('sender').notNull(),recipient:text('recipient').notNull(),body:text('body').notNull(),at:integer('at').notNull()});
export const rateLimits=sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),windowStart:integer('window_start').notNull()});
