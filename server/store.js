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
    -- role: user 普通用户；admin 管理员；super_admin 超级管理员。
    -- status: pending 待审核；approved 已通过；rejected 已拒绝；suspended 已停用。
    -- 手机号与邮箱是可选的唯一登录名；密码只保存带随机盐的 scrypt 摘要。
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY, phone TEXT UNIQUE, email TEXT UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending', must_change_password INTEGER NOT NULL DEFAULT 0,
      reviewed_by TEXT, reviewed_at INTEGER, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS accounts_status ON accounts(status);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    -- action: approve 审核通过；reject 拒绝；suspend 停用；role 调整角色；password 修改密码。
    CREATE TABLE IF NOT EXISTS account_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL,
      user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL
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
    -- 引用回复：只记录被引用消息的标识，引用内容在读取时按原消息的最新状态生成。
    CREATE TABLE IF NOT EXISTS message_replies (message_id TEXT PRIMARY KEY, reply_to TEXT NOT NULL);
    -- @提及：user_id 为成员标识，'*' 表示 @所有人。
    -- 转发：记录原发送人与原发送时间，用来显示「转发自」。
    CREATE TABLE IF NOT EXISTS message_forwards (message_id TEXT PRIMARY KEY, original_sender TEXT NOT NULL, original_created_at INTEGER NOT NULL);
    -- 表情回应：每人对同一条消息的同一个表情只记一次。
    CREATE TABLE IF NOT EXISTS message_reactions (message_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (message_id, user_id, emoji));
    CREATE TABLE IF NOT EXISTS message_mentions (message_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (message_id, user_id));
    CREATE TABLE IF NOT EXISTS pending_file_deletions (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS history_state (id INTEGER PRIMARY KEY, cleared_through_seq INTEGER NOT NULL);
    INSERT OR IGNORE INTO history_state VALUES (1,0);
    CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id, seq);
    -- 禁言：管理员可以让成员一段时间（或一直）不能发言；until 为空表示直到解除。
    CREATE TABLE IF NOT EXISTS member_mutes (user_id TEXT PRIMARY KEY, until INTEGER, muted_by TEXT NOT NULL, muted_at INTEGER NOT NULL);
    -- 空间设置：retention_days 消息保留天数，0 表示永久保留。
    CREATE TABLE IF NOT EXISTS space_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- 话题：话题里的回复属于同一会话，但不出现在主时间线，也不计入会话未读；根消息上显示回复数。
    CREATE TABLE IF NOT EXISTS message_threads (message_id TEXT PRIMARY KEY, root_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS message_threads_root ON message_threads(root_id);
    -- 个人资料：部门和签名（可选）；最后在线时间在最后一个连接断开时记下。
    CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, department TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', last_seen INTEGER);
    -- 定时消息：到点由服务器以发送人的身份发出（只支持文字，不带 @提醒）；提醒：到点只通知设置的人自己。
    CREATE TABLE IF NOT EXISTS scheduled_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, send_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, message_id TEXT NOT NULL, remind_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    -- 投票：投票本身是一条消息（正文是问题），选项与投票人另存；投票公开，大家能看到谁投了什么。
    CREATE TABLE IF NOT EXISTS polls (message_id TEXT PRIMARY KEY, options TEXT NOT NULL, multiple INTEGER NOT NULL DEFAULT 0, closed_at INTEGER);
    CREATE TABLE IF NOT EXISTS poll_votes (message_id TEXT NOT NULL, user_id TEXT NOT NULL, option_index INTEGER NOT NULL, voted_at INTEGER NOT NULL, PRIMARY KEY (message_id, user_id, option_index));
    -- 收藏：每人自己的收藏夹，只记消息标识；消息撤回或自己失去访问权后不再列出。
    CREATE TABLE IF NOT EXISTS saved_messages (user_id TEXT NOT NULL, message_id TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (user_id, message_id));
    -- 会话内置顶的消息：群主、空间管理者或私聊双方可以置顶，每个会话最多 20 条。
    CREATE TABLE IF NOT EXISTS room_pins (room_id TEXT NOT NULL, message_id TEXT NOT NULL, pinned_by TEXT NOT NULL, pinned_at INTEGER NOT NULL, PRIMARY KEY (room_id, message_id));
    -- 管理员删除的消息：与撤回一样清空内容，另记下是谁删的，界面显示「管理员删除了一条消息」。
    CREATE TABLE IF NOT EXISTS message_removals (message_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, removed_at INTEGER NOT NULL);
    -- 链接预览缓存：成功的保留一天，失败的保留一小时，避免反复抓取同一个网址。
    CREATE TABLE IF NOT EXISTS link_previews (url TEXT PRIMARY KEY, data TEXT, error TEXT, fetched_at INTEGER NOT NULL);
    -- 图片缩略图：客户端上传原图后再传一张小图，发送时随附件一起记录；聊天里显示小图，查看大图时才加载原图。
    CREATE TABLE IF NOT EXISTS upload_thumbnails (upload_id TEXT PRIMARY KEY, thumb_id TEXT NOT NULL);
    -- 账号模式的登录设备：按登录会话记下设备描述、来源地址和最后活跃时间，用于「登录设备」列表。
    CREATE TABLE IF NOT EXISTS session_devices (token_hash TEXT PRIMARY KEY, user_agent TEXT NOT NULL, ip TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    -- 编辑过的消息记下最后一次编辑时间，界面显示「已编辑」。
    CREATE TABLE IF NOT EXISTS message_edits (message_id TEXT PRIMARY KEY, edited_at INTEGER NOT NULL);
    -- 群机器人：外部系统凭地址里的令牌向一个会话发消息；只保存令牌摘要。机器人发的消息另记名字，删掉机器人后仍能显示。
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS message_bots (message_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    -- 群聊设置：群主（为空或已不在群里时由最早的成员接任）与群公告。
    CREATE TABLE IF NOT EXISTS room_settings (room_id TEXT PRIMARY KEY, owner_id TEXT, announcement TEXT NOT NULL DEFAULT '', announcement_at INTEGER, announcement_by TEXT);
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
