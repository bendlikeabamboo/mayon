CREATE TABLE "agent_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"assistant_message_id" text,
	"model" text,
	"config_kind" text NOT NULL,
	"reasoning" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"lab_id" text,
	"quiz_id" text,
	"created_at" bigint NOT NULL,
	"duration_ms" integer,
	"trace" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"source_message_id" text NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"excerpt" text NOT NULL,
	"branch_chat_id" text NOT NULL,
	"custom_instructions" text,
	"add_formats" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"root_id" text NOT NULL,
	"branch_point_message_id" text,
	"title" text NOT NULL,
	"depth" integer NOT NULL,
	"provider" text,
	"model" text,
	"brief" text,
	"mcp_config" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cross_links" (
	"id" text PRIMARY KEY NOT NULL,
	"from_chat_id" text NOT NULL,
	"to_chat_id" text NOT NULL,
	"note" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labs" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"checklist" text DEFAULT '[]' NOT NULL,
	"model" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"ord" integer NOT NULL,
	"model" text,
	"tokens" integer,
	"tool_call_id" text,
	"tool_name" text,
	"metadata" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"is_correct" boolean,
	"ai_feedback" text,
	"graded_at" bigint
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"quiz_id" text NOT NULL,
	"score" integer,
	"started_at" bigint NOT NULL,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"quiz_id" text NOT NULL,
	"ord" integer NOT NULL,
	"type" text NOT NULL,
	"prompt" text NOT NULL,
	"payload" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"model" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_sources" ADD CONSTRAINT "branch_sources_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_sources" ADD CONSTRAINT "branch_sources_branch_chat_id_chats_id_fk" FOREIGN KEY ("branch_chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_parent_id_chats_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_root_id_chats_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_branch_point_message_id_messages_id_fk" FOREIGN KEY ("branch_point_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_links" ADD CONSTRAINT "cross_links_from_chat_id_chats_id_fk" FOREIGN KEY ("from_chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_links" ADD CONSTRAINT "cross_links_to_chat_id_chats_id_fk" FOREIGN KEY ("to_chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;