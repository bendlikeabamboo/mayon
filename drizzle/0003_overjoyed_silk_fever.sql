CREATE TABLE `agent_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`assistant_message_id` text,
	`model` text,
	`config_kind` text NOT NULL,
	`reasoning` text NOT NULL,
	`created_at` integer NOT NULL,
	`duration_ms` integer,
	`trace` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
