-- FTS5 full-text search index (hand-authored, NOT a drizzle model).
-- Kept in sync by triggers on messages, chats, labs, quiz_questions.
-- Do NOT add to schema.ts — FTS5 virtual tables are not drizzle tables.
CREATE VIRTUAL TABLE search_fts USING fts5(
  kind UNINDEXED,
  title,
  body,
  chat_id UNINDEXED,
  ref_id UNINDEXED,
  quiz_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- messages
CREATE TRIGGER search_fts_messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    VALUES('message','',new.content,new.chat_id,new.id,NULL);
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM search_fts WHERE kind='message' AND ref_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_messages_au AFTER UPDATE ON messages BEGIN
  DELETE FROM search_fts WHERE kind='message' AND ref_id = old.id;
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    VALUES('message','',new.content,new.chat_id,new.id,NULL);
END;
--> statement-breakpoint
-- chats (title only)
CREATE TRIGGER search_fts_chats_ai AFTER INSERT ON chats BEGIN
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    VALUES('chat',new.title,'',new.id,new.id,NULL);
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_chats_ad AFTER DELETE ON chats BEGIN
  DELETE FROM search_fts WHERE kind='chat' AND ref_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_chats_au AFTER UPDATE ON chats BEGIN
  DELETE FROM search_fts WHERE kind='chat' AND ref_id = old.id;
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    VALUES('chat',new.title,'',new.id,new.id,NULL);
END;
--> statement-breakpoint
-- labs (title + content)
CREATE TRIGGER search_fts_labs_ai AFTER INSERT ON labs BEGIN
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    VALUES('lab',new.title,new.content,new.chat_id,new.id,NULL);
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_labs_ad AFTER DELETE ON labs BEGIN
  DELETE FROM search_fts WHERE kind='lab' AND ref_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_labs_au AFTER UPDATE ON labs BEGIN
  DELETE FROM search_fts WHERE kind='lab' AND ref_id = old.id;
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    VALUES('lab',new.title,new.content,new.chat_id,new.id,NULL);
END;
--> statement-breakpoint
-- quiz_questions (prompt; chat_id resolved via the quiz)
CREATE TRIGGER search_fts_qq_ai AFTER INSERT ON quiz_questions BEGIN
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    SELECT 'quiz_question','',new.prompt,q.chat_id,new.id,new.quiz_id
    FROM quizzes q WHERE q.id = new.quiz_id;
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_qq_ad AFTER DELETE ON quiz_questions BEGIN
  DELETE FROM search_fts WHERE kind='quiz_question' AND ref_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_fts_qq_au AFTER UPDATE ON quiz_questions BEGIN
  DELETE FROM search_fts WHERE kind='quiz_question' AND ref_id = old.id;
  INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
    SELECT 'quiz_question','',new.prompt,q.chat_id,new.id,new.quiz_id
    FROM quizzes q WHERE q.id = new.quiz_id;
END;
--> statement-breakpoint
-- one-time backfill (raw text — noise stripping is applied only by rebuildIndex())
INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
  SELECT 'chat', title, '', id, id, NULL FROM chats;
--> statement-breakpoint
INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
  SELECT 'message', '', content, chat_id, id, NULL FROM messages;
--> statement-breakpoint
INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
  SELECT 'lab', title, content, chat_id, id, NULL FROM labs;
--> statement-breakpoint
INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id)
  SELECT 'quiz_question', '', qq.prompt, q.chat_id, qq.id, qq.quiz_id
  FROM quiz_questions qq JOIN quizzes q ON q.id = qq.quiz_id;
