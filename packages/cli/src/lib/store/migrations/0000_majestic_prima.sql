CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`metadata` text,
	`status` text DEFAULT 'complete' NOT NULL,
	`ord` integer NOT NULL,
	`time_started` integer,
	`time_completed` integer,
	`duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_session_ord_uq` ON `message` (`session_id`,`ord`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`directory` text NOT NULL,
	`title` text NOT NULL,
	`model` text,
	`reasoning_effort` text DEFAULT 'medium' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_directory_idx` ON `session` (`directory`);