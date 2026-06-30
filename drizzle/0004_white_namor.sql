ALTER TABLE `agent_traces` ADD `kind` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_traces` ADD `lab_id` text REFERENCES labs(id);--> statement-breakpoint
ALTER TABLE `agent_traces` ADD `quiz_id` text REFERENCES quizzes(id);