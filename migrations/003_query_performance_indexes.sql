CREATE INDEX IF NOT EXISTS idx_assignments_user_status_due
  ON assignments(user_id, done, due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status_updated
  ON study_tasks(user_id, done, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_visible_created
  ON messages(conversation_id, deleted_at, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cgpa_entries_user_created
  ON cgpa_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_published_created
  ON announcements(published, published_at DESC, id DESC);
