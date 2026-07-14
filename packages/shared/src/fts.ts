export const FTS_BOOTSTRAP_SQL: string[] = [
	"CREATE OR REPLACE FUNCTION strip_search_noise(input text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT regexp_replace(regexp_replace(coalesce(input, ''), '\\$\\$[\\s\\S]*?\\$\\$', ' ', 'g'), '```[\\s\\S]*?```', ' ', 'g'); $$;",

	"ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vec tsvector GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(content))) STORED;",

	"ALTER TABLE chats ADD COLUMN IF NOT EXISTS search_vec tsvector GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(title))) STORED;",

	"ALTER TABLE labs ADD COLUMN IF NOT EXISTS search_vec tsvector GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(title || ' ' || content))) STORED;",

	"ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS search_vec tsvector GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(prompt))) STORED;",

	'CREATE INDEX IF NOT EXISTS messages_search_vec_idx ON messages USING gin (search_vec);',

	'CREATE INDEX IF NOT EXISTS chats_search_vec_idx ON chats USING gin (search_vec);',

	'CREATE INDEX IF NOT EXISTS labs_search_vec_idx ON labs USING gin (search_vec);',

	'CREATE INDEX IF NOT EXISTS quiz_questions_search_vec_idx ON quiz_questions USING gin (search_vec);'
];
