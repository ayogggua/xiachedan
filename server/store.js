import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'chat.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    -- 删除和覆盖的内容用 0 抹掉（撤回、阅后即焚销毁后，库文件里不留原文）。
    PRAGMA secure_delete = ON;
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
    -- 拍一拍：一条没有正文的特殊消息，记下被拍的人。
    CREATE TABLE IF NOT EXISTS message_nudges (message_id TEXT PRIMARY KEY, target_id TEXT NOT NULL);
    -- 引用回复时只引用原消息里选中的一段文字（Telegram 式）；原消息撤回或清空后随之删除。
    CREATE TABLE IF NOT EXISTS message_reply_quotes (message_id TEXT PRIMARY KEY, quote TEXT NOT NULL);
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
    -- 合并转发：一条消息里打包多条消息的快照（发送人、时间、正文、附件），附件已复制到目标会话。
    CREATE TABLE IF NOT EXISTS message_bundles (message_id TEXT PRIMARY KEY, title TEXT NOT NULL, items TEXT NOT NULL);
    -- 群头像：群主（大厅由空间管理者）设置；upload_id 保存上传 UUID 或 preset:<内置头像 ID>，没有记录时显示默认图标。
    CREATE TABLE IF NOT EXISTS room_avatars (room_id TEXT PRIMARY KEY, upload_id TEXT NOT NULL);
    -- 名字颜色：每人在 7 种昵称色里自选一种（编号 0–6），没选时按身份自动分配。
    CREATE TABLE IF NOT EXISTS user_name_colors (user_id TEXT PRIMARY KEY, color INTEGER NOT NULL);
    -- 群策略：全员禁言、入群审批、邀请链接（令牌只给群主和管理员看，为空表示没有链接）。
    CREATE TABLE IF NOT EXISTS room_group_policy (room_id TEXT PRIMARY KEY, all_muted INTEGER NOT NULL DEFAULT 0, join_approval INTEGER NOT NULL DEFAULT 0, invite_token TEXT, invite_at INTEGER);
    -- 入群申请：开了入群审批后，通过链接加入或普通成员拉人都先进申请，由群主或管理员处理。
    CREATE TABLE IF NOT EXISTS room_join_requests (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id TEXT NOT NULL, invited_by TEXT, created_at INTEGER NOT NULL, UNIQUE (room_id, user_id));
    -- 群昵称：成员在某个群里显示的名字，只在这个群里生效。
    CREATE TABLE IF NOT EXISTS room_nicknames (room_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT NOT NULL, PRIMARY KEY (room_id, user_id));
    -- 群管理员：由群主指定，可以改群名和公告、移出普通成员。
    CREATE TABLE IF NOT EXISTS room_admins (room_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (room_id, user_id));
    -- 自定义状态：一个表情加一段文字，until 到期后不再显示（为空表示不自动清除）。
    CREATE TABLE IF NOT EXISTS user_status (user_id TEXT PRIMARY KEY, emoji TEXT NOT NULL, text TEXT NOT NULL, until INTEGER);
    -- 按会话自动删除：消息发出超过 seconds 秒后为所有人删除（阅后即焚，Telegram 式定时）。
    CREATE TABLE IF NOT EXISTS room_auto_delete (room_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL, set_by TEXT NOT NULL, set_at INTEGER NOT NULL);
    -- 关键词提醒：消息里出现这些词时像被 @ 一样提醒，跨设备同步。
    CREATE TABLE IF NOT EXISTS message_hidden (user_id TEXT NOT NULL, message_id TEXT NOT NULL, hidden_at INTEGER NOT NULL, PRIMARY KEY (user_id, message_id));
    CREATE TABLE IF NOT EXISTS room_cleared (user_id TEXT NOT NULL, room_id TEXT NOT NULL, through_seq INTEGER NOT NULL, cleared_at INTEGER NOT NULL, PRIMARY KEY (user_id, room_id));
    CREATE TABLE IF NOT EXISTS user_stickers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS user_stickers_user ON user_stickers(user_id, created_at);
    CREATE TABLE IF NOT EXISTS upload_stickers (upload_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS user_phrases (user_id TEXT PRIMARY KEY, phrases TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS message_cards (message_id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, muted TEXT NOT NULL DEFAULT '[]', private INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
    CREATE TABLE IF NOT EXISTS user_keywords (user_id TEXT PRIMARY KEY, keywords TEXT NOT NULL);
    -- 会话文件夹：每人自建，存会话标识列表，跨设备同步。
    CREATE TABLE IF NOT EXISTS user_folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, room_ids TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS user_folders_user ON user_folders(user_id);
    -- 备注：成员给别人写的私人备注，只有写的人自己能看到。
    CREATE TABLE IF NOT EXISTS user_notes (owner_id TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (owner_id, user_id));
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
    -- 接龙：接龙本身是一条消息（正文是标题），说明、示例格式和每人的一行另存；每人最多一行，序号按加入先后（自增 id）排。
    CREATE TABLE IF NOT EXISTS chains (message_id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', example TEXT NOT NULL DEFAULT '', closed_at INTEGER, closed_by TEXT);
    -- 阅后即焚（只在私聊）：seconds 是对方点开后保留的秒数；opened_at 是接收人点开的时间（服务器时钟），destroyed_at 是销毁时间。
    -- 销毁后正文和附件清空、文件删除，消息只剩一行「已销毁」。burn_files 记下这类消息的附件和缩略图，供下载时核对能不能看。
    CREATE TABLE IF NOT EXISTS message_burns (message_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL, opened_at INTEGER, destroyed_at INTEGER);
    CREATE TABLE IF NOT EXISTS burn_files (upload_id TEXT PRIMARY KEY, message_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS burn_files_message ON burn_files(message_id);
    -- 每次接口访问都要找到点的阅后即焚消息：只索引正在倒计时的那些。
    CREATE INDEX IF NOT EXISTS message_burns_counting ON message_burns(opened_at) WHERE destroyed_at IS NULL AND opened_at IS NOT NULL;
    CREATE TABLE IF NOT EXISTS chain_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, joined_at INTEGER NOT NULL, edited_at INTEGER, UNIQUE (message_id, user_id));
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
    -- 编辑历史：每次编辑前的正文。earlier_lost=1 表示在保存历史之前已经编辑过，更早的版本没有记录。
    CREATE TABLE IF NOT EXISTS message_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, text TEXT NOT NULL, replaced_at INTEGER NOT NULL, earlier_lost INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS message_versions_message ON message_versions(message_id);
    -- 群机器人：外部系统凭地址里的令牌向一个会话发消息；只保存令牌摘要。机器人发的消息另记名字，删掉机器人后仍能显示。
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS message_bots (message_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    -- 机器人账号：名字、头像、简介和成员一样存在 users / user_profiles（id 相同），这里是机器人自己的设置。
    -- token_hash 是调用发消息接口的令牌摘要；secret 是给推送事件签名的密钥（服务器签名要用原文），两者都只在创建和重置时显示一次。
    -- status: enabled 启用；disabled 管理者停用；failed 连续投递失败后自动停用。deleted_at 不为空表示已删除，之前发的消息照常显示名字。
    CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, secret TEXT NOT NULL, callback_url TEXT NOT NULL DEFAULT '', receive_all INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'enabled', failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_error_at INTEGER, last_delivered_at INTEGER,
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER);
    -- 机器人在哪些群聊和大厅里：after_seq 是加入时最新一条消息的序号，它只收在这之后的消息。私聊不记在这里，私聊的两位成员就是用户和机器人。
    CREATE TABLE IF NOT EXISTS bot_rooms (bot_id TEXT NOT NULL, room_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at INTEGER NOT NULL, after_seq INTEGER NOT NULL, PRIMARY KEY (bot_id, room_id));
    CREATE INDEX IF NOT EXISTS bot_rooms_room ON bot_rooms(room_id);
    -- 推给机器人的消息：delivered_at 为空表示还在排队或没送到。撤回、编辑只通知真正收到过原消息的机器人。
    CREATE TABLE IF NOT EXISTS bot_deliveries (message_id TEXT NOT NULL, bot_id TEXT NOT NULL, delivered_at INTEGER, PRIMARY KEY (message_id, bot_id));
    -- 会话里的系统提示（机器人加入或移出、开关「接收全部消息」）：发送人为 system，正文在生成时写好。
    CREATE TABLE IF NOT EXISTS message_notices (message_id TEXT PRIMARY KEY, kind TEXT NOT NULL, bot_id TEXT);
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
