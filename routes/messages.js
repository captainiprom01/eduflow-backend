const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { broadcastToUsers } = require('../realtime');

const router = express.Router();
router.use(requireAuth);

function cleanText(value, maxLength = 4000) {
  return value == null ? '' : String(value).trim().slice(0, maxLength);
}

async function assertMember(conversationId, userId) {
  const result = await pool.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return result.rowCount > 0;
}

router.get('/contacts', async (req, res) => {
  try {
    const search = cleanText(req.query.search, 80);
    const result = await pool.query(
      `SELECT id, name, email, school, department, programme, level
       FROM users
       WHERE id <> $1
         AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
       ORDER BY name ASC
       LIMIT 30`,
      [req.userId, search]
    );
    res.json({ contacts: result.rows });
  } catch (e) {
    console.error('list message contacts error', e);
    res.status(500).json({ error: 'Could not load contacts.' });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.id,
         c.kind,
         c.title,
         c.created_at,
         c.updated_at,
         latest.body AS last_message,
         latest.created_at AS last_message_at,
         latest.sender_id AS last_sender_id,
         COALESCE((
           SELECT COUNT(*)::int
           FROM messages unread
           WHERE unread.conversation_id = c.id
             AND unread.sender_id <> $1
             AND unread.deleted_at IS NULL
             AND unread.created_at > COALESCE(cm.last_read_at, to_timestamp(0))
         ), 0) AS unread_count,
         COALESCE((
           SELECT json_agg(json_build_object('id', member_user.id, 'name', member_user.name, 'email', member_user.email) ORDER BY member_user.name)
           FROM conversation_members other_cm
           JOIN users member_user ON member_user.id = other_cm.user_id
           WHERE other_cm.conversation_id = c.id
         ), '[]'::json) AS members
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       LEFT JOIN LATERAL (
         SELECT body, created_at, sender_id
         FROM messages
         WHERE conversation_id = c.id AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) latest ON true
       ORDER BY COALESCE(latest.created_at, c.updated_at) DESC, c.id DESC`,
      [req.userId]
    );
    res.json({ conversations: result.rows });
  } catch (e) {
    console.error('list conversations error', e);
    res.status(500).json({ error: 'Could not load conversations.' });
  }
});

router.post('/groups', async (req, res) => {
  const title = cleanText(req.body && req.body.title, 120);
  const requestedIds = Array.isArray(req.body && req.body.userIds) ? req.body.userIds : [];
  const memberIds = [...new Set([req.userId, ...requestedIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)])];
  if (!title) return res.status(400).json({ error: 'Group name is required.' });
  if (memberIds.length < 3) return res.status(400).json({ error: 'Add at least two other users to create a group.' });

  try {
    const users = await pool.query('SELECT id FROM users WHERE id = ANY($1::int[])', [memberIds]);
    if (users.rowCount !== memberIds.length) return res.status(400).json({ error: 'One or more selected users could not be found.' });
    const conversation = await pool.query(
      `INSERT INTO conversations (kind, title, created_by) VALUES ('group', $1, $2) RETURNING id`,
      [title, req.userId]
    );
    const conversationId = conversation.rows[0].id;
    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       SELECT $1, member_id, CASE WHEN member_id = $2 THEN now() ELSE NULL END
       FROM unnest($3::int[]) AS member_id`,
      [conversationId, req.userId, memberIds]
    );
    broadcastToUsers(memberIds, { type: 'conversation.created', conversationId });
    res.status(201).json({ conversationId, title, memberCount: memberIds.length });
  } catch (e) {
    console.error('create group conversation error', e);
    res.status(500).json({ error: 'Could not create group conversation.' });
  }
});

router.post('/conversations', async (req, res) => {
  const otherUserId = Number(req.body && (req.body.userId || req.body.user_id));
  if (!Number.isInteger(otherUserId) || otherUserId <= 0 || otherUserId === req.userId) {
    return res.status(400).json({ error: 'Choose another user to start a conversation.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const otherUser = await client.query('SELECT id, name, email FROM users WHERE id = $1', [otherUserId]);
    if (!otherUser.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    const existing = await client.query(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = $1
       JOIN conversation_members theirs ON theirs.conversation_id = c.id AND theirs.user_id = $2
       WHERE c.kind = 'direct'
         AND (SELECT COUNT(*) FROM conversation_members count_members WHERE count_members.conversation_id = c.id) = 2
       LIMIT 1`,
      [req.userId, otherUserId]
    );

    let conversationId;
    if (existing.rowCount) {
      conversationId = existing.rows[0].id;
    } else {
      const conversation = await client.query(
        `INSERT INTO conversations (kind, created_by) VALUES ('direct', $1) RETURNING id, kind, title, created_at, updated_at`,
        [req.userId]
      );
      conversationId = conversation.rows[0].id;
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
         VALUES ($1, $2, now()), ($1, $3, NULL)`,
        [conversationId, req.userId, otherUserId]
      );
    }
    await client.query('COMMIT');
    if (!existing.rowCount) broadcastToUsers([otherUserId], { type: 'conversation.created', conversationId });
    res.status(existing.rowCount ? 200 : 201).json({ conversationId, user: otherUser.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create conversation error', e);
    res.status(500).json({ error: 'Could not start conversation.' });
  } finally {
    client.release();
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId)) return res.status(400).json({ error: 'Invalid conversation.' });
  try {
    if (!(await assertMember(conversationId, req.userId))) return res.status(404).json({ error: 'Conversation not found.' });
    await pool.query(
      'UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.userId]
    );
    const result = await pool.query(
      `SELECT m.id, m.conversation_id, m.sender_id, u.name AS sender_name, m.body, m.created_at, m.edited_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 500`,
      [conversationId]
    );
    res.json({ messages: result.rows });
  } catch (e) {
    console.error('list messages error', e);
    res.status(500).json({ error: 'Could not load messages.' });
  }
});

router.post('/conversations/:id/messages', async (req, res) => {
  const conversationId = Number(req.params.id);
  const body = cleanText(req.body && req.body.body);
  if (!Number.isInteger(conversationId)) return res.status(400).json({ error: 'Invalid conversation.' });
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (!(await assertMember(conversationId, req.userId))) return res.status(404).json({ error: 'Conversation not found.' });

  try {
    const result = await pool.query(
      `WITH inserted AS (
         INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING *
       )
       SELECT inserted.id, inserted.conversation_id, inserted.sender_id, u.name AS sender_name,
              inserted.body, inserted.created_at, inserted.edited_at
       FROM inserted JOIN users u ON u.id = inserted.sender_id`,
      [conversationId, req.userId, body]
    );
    await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
    await pool.query(
      'UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.userId]
    );
    const members = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = $1', [conversationId]);
    broadcastToUsers(members.rows.map((member) => member.user_id), { type: 'message.created', conversationId, message: result.rows[0] });
    res.status(201).json({ message: result.rows[0] });
  } catch (e) {
    console.error('send message error', e);
    res.status(500).json({ error: 'Could not send message.' });
  }
});

module.exports = router;
