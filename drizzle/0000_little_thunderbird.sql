CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`participant_id` text,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`score` real,
	`result_json` text,
	`error` text,
	`provider` text,
	`model` text,
	`created` integer NOT NULL,
	`completed` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_target` ON `jobs` (`kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `job_queue` ON `jobs` (`status`,`lease_until`);--> statement-breakpoint
CREATE TABLE `messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`created` integer NOT NULL,
	`request_id` text,
	`reply_status` text,
	`error` text,
	`context_json` text,
	`provider` text,
	`model` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_unique` ON `messages` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_request_id_unique` ON `messages` (`request_id`);--> statement-breakpoint
CREATE INDEX `message_session` ON `messages` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `participants` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`google_sub` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_id_unique` ON `participants` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_google_sub_unique` ON `participants` (`google_sub`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_snapshot` text NOT NULL,
	`started` integer NOT NULL,
	`finished` integer,
	`busy_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_participant_task` ON `study_sessions` (`participant_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`file_key` text NOT NULL,
	`filename` text NOT NULL,
	`code_sha` text NOT NULL,
	`explanation` text NOT NULL,
	`artifacts` text DEFAULT '[]' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `submission_session` ON `submissions` (`session_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`rubric` text NOT NULL,
	`minutes` integer NOT NULL,
	`sort` integer NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`materials` text DEFAULT '[]' NOT NULL,
	`updated` integer NOT NULL
);
