import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'chat.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
    );
    -- kind: public 公共大厅；group 多人群聊；direct 两人私聊。不使用外键或枚举。
    CREATE TABLE IF NOT EXISTS space_admin (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS removed_users (user_id TEXT PRIMARY KEY, removed_at INTEGER NOT NULL);
    -- 桌面端按电脑识别身份：每台电脑为每个空间保存一份随机凭证，这里只存哈希；space_identity 是不随 IP 变化的空间编号。
    CREATE TABLE IF NOT EXISTS user_devices (device_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS space_identity (id INTEGER PRIMARY KEY, space_id TEXT NOT NULL);
    INSERT OR IGNORE INTO space_identity VALUES (1, lower(hex(randomblob(16))));
    INSERT OR IGNORE INTO space_admin (id,user_id) SELECT 1,id FROM users ORDER BY rowid LIMIT 1;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      members TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]', client_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(sender_id, client_id)
    );
    -- 撤回记录只保留消息标识与撤回时间，原正文和附件引用会清除。
    CREATE TABLE IF NOT EXISTS message_recalls (message_id TEXT PRIMARY KEY, recalled_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_file_deletions (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS history_state (id INTEGER PRIMARY KEY, cleared_through_seq INTEGER NOT NULL);
    INSERT OR IGNORE INTO history_state VALUES (1,0);
    CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id, seq);
    -- 每条消息、每位接收者仅保存一次实际查看时间。
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );
    -- purpose: message 聊天附件；avatar 用户头像。mime 保存实际检测到的文件类型。
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, room_id TEXT,
      name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
      purpose TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function serializeMessage(row) {
  if (!row) return null;
  return { id: row.id, seq: row.seq, roomId: row.room_id, senderId: row.sender_id,
    text: row.text, attachments: JSON.parse(row.attachments), clientId: row.client_id,
    createdAt: row.created_at };
}
