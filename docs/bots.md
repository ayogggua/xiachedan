# 机器人接口

机器人是空间里的独立成员：有名字、头像和简介，带「机器人」标记，可以被拉进多个群聊，也能和成员私聊。它和成员面板里的「群机器人（Webhook）」（只能往一个会话发消息）是两回事。

空间管理者（局域网模式是空间创建者，账号模式是管理员）在「设置 · 空间 · 机器人」里创建机器人，创建或重置时会显示一次**令牌**和**签名密钥**，请马上保存。群主、群管理员可以把启用中的机器人拉进群（大厅由空间管理者添加），成员可以直接和它私聊。每个空间最多 50 个机器人，每个群聊或大厅最多 10 个。

## 收消息

填写回调地址后，服务器把事件以 JSON `POST` 到这个地址：

- 群聊和大厅里默认只发 @它的消息；管理者打开「接收全部消息」后发全部消息，群里会显示提示。私聊里总是发全部消息。
- 不会发：阅后即焚消息、拍一拍、系统提示、机器人和群机器人（Webhook）发的消息、它加入之前的消息、它不在的会话。
- 剧透按原文发送；附件只给名字、类型和大小。
- 撤回、编辑只通知收到过原消息的机器人；被移出后再拉回来，重新加入之前的消息（哪怕上次收到过）也不再通知。

```json
{
  "id": "4b1e…", "type": "message.created", "createdAt": 1762934400000,
  "bot": { "id": "9c2f…" },
  "room": { "id": "…", "kind": "group", "name": "值班群" },
  "message": {
    "id": "…", "seq": 1024, "createdAt": 1762934400000, "kind": "text",
    "text": "@助手 今天谁值班？",
    "sender": { "id": "…", "name": "Alice", "bot": false },
    "mentions": ["9c2f…"], "mentioned": true, "threadOf": null, "forwarded": false, "editedAt": null,
    "replyTo": null,
    "attachments": [{ "name": "日志.txt", "mime": "application/octet-stream", "size": 2048 }, { "name": "结局.png", "mime": "image/png", "size": 51200, "spoiler": true }]
  }
}
```

点「发送测试事件」时发的是：

```json
{ "id": "…", "type": "bot.test", "createdAt": 1762934400000, "bot": { "id": "9c2f…", "name": "助手" } }
```

- `type`：`message.created`、`message.edited`（`message` 是改过后的内容）、`message.recalled`（`message` 只有 `id`、`seq`）、`bot.test`（管理页面里点「发送测试事件」）。
- `room.kind`：`public` 大厅、`group` 群聊、`direct` 私聊（私聊的 `name` 为空，对方见 `sender`）。
- `message.kind`：`text`、`poll`（`text` 是问题，另有 `poll: { multiple, options }`，`multiple` 表示能否多选，`options` 是选项文字）、`chain`（接龙，`text` 是标题）、`card`（名片，另有 `card: { userId }`，是被推荐的成员）、`bundle`（合并转发，`text` 是标题）。
- `attachments[].spoiler`：发送人标成剧透的图片或视频才有，值为 `true`。
- `replyTo`：引用的原消息 `{ id, sender, text, quote? }`；原消息在它加入之前或是阅后即焚时只有 `{ id, unavailable: true }`，撤回后 `{ id, recalled: true }`，已被删除时 `{ id, missing: true }`。

### 校验签名

每个请求带这些请求头：`X-Xiachedan-Event`（事件类型）、`X-Xiachedan-Delivery`（事件 `id`，重试时不变，可用来去重）、`X-Xiachedan-Timestamp`（秒）、`X-Xiachedan-Signature: v1=<十六进制>`。签名是用签名密钥对 `时间戳 + "." + 原始请求体` 做的 HMAC-SHA256。签名密钥是 64 位十六进制字符串，**把这串字符原样当作密钥**（UTF-8 字节），不要先解码成 32 个字节。请用原始请求体计算，并拒绝时间相差超过 5 分钟的请求，防止重放：

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, headers, rawBody) {
  const timestamp = headers['x-xiachedan-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const given = Buffer.from(headers['x-xiachedan-signature'] || '');
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected));
}
```

```python
import hashlib, hmac, time

def verify(secret: str, headers: dict, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Xiachedan-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    message = timestamp.encode() + b"." + raw_body
    expected = "v1=" + hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers.get("X-Xiachedan-Signature", ""))
```

### 回应与重试

- 5 秒内回 2xx 就算送达，这 5 秒包括解析域名、建立连接和等回应；回应内容直接丢弃，不保存也不记录；不跟随重定向（3xx 算失败）。
- 网络错误、超时、5xx、408、429 会在 2 秒、10 秒、30 秒后重试；同一个机器人的事件按顺序一个个发。
- 每次投递都会现解析回调域名（不缓存），解析时间算在上面的 5 秒里：5 秒内没解析完就按超时处理，之后才回来的结果也不会再去连接。
- 连续 5 个事件发送失败后机器人自动停用，管理页面显示最后的错误和时间，修好后重新启用即可。服务重启时还没送出的事件会丢弃。
- 局域网模式下域名用系统的解析（认 `/etc/hosts` 和 `.local`）。系统解析会占用服务进程里有限的后台线程，所以同时最多解析 2 个域名：多出来的排队，最多等到这次投递的 5 秒截止；同一个域名正在解析时，后来的直接共用那一次的结果。排队到截止也没轮到的这次投递会重试，但**不算**进连续失败、不会因此自动停用，管理页面的「最近错误」会写明「这次没排上」。
- 账号模式下管理页面只显示几类笼统的原因（无法连接、超时、对方返回 HTTP 状态码、证书校验失败、地址不是公网等），不带底层错误码，详细原因写在服务器日志里；局域网模式照实显示。

## 发消息

```
POST /api/bot/v1/messages
Authorization: Bearer <令牌>
Content-Type: application/json

{ "roomId": "…", "text": "今天是 @Bob 值班", "mentions": ["<Bob 的 id>"], "replyTo": "<消息 id，可选>", "clientId": "<去重用，可选>" }
```

成功返回 `201 { "message": { "id", "seq", "roomId", "createdAt" } }`。同一个机器人用同一个 `clientId` 再发返回 `200` 和原来那条，不会再发一次；去重按机器人算、不分会话（换个 `roomId` 用同一个 `clientId`，拿到的也是原来那条）。

- 只能发到它在的群聊、大厅，或成员和它开过的私聊；全员禁言时也不能发。
- 只能发文字，1–10000 个字；`mentions` 里的人要在会话里、正文里写着「@名字」，不能 @所有人；`replyTo` 只能引用同一会话里它加入之后的消息。不能带附件、不能发阅后即焚、不能在话题里回复。
- 每个机器人任意 60 秒内最多 60 条（滑动窗口），超出返回 429。令牌无效返回 401，机器人已停用返回 403。
- 账号模式下服务端会检查 `Origin` 请求头：机器人程序是服务器之间的调用，不要带浏览器的 `Origin`（带了不在允许列表里的来源会被 403 拒绝），也不要从网页里直接调用这个接口。
- `GET /api/bot/v1/me` 返回机器人自己和它所在的会话列表，可以用来检查令牌。

## 回调地址的限制

回调地址只能是 http 或 https，不能带用户名密码，端口不能是 0，规范化之后（中文路径会被编码、国际化域名转成 punycode）最长 2048 个字符。

账号模式下，服务器直接向 DNS 服务器查询回调域名的 A 和 AAAA 记录：不读 `/etc/hosts`、不追加搜索域、不认 `.local`，所以回调域名必须是能被公共 DNS 解析的完整域名；CNAME 会跟到最后的地址再检查。这种查询不占用服务进程的后台线程，到截止时间就取消，解析很慢或不回应的域名不会影响别的机器人和其他功能。服务器每次投递时现解析域名，只要解析出的地址里有本机、内网、链路本地、运营商内网、组播、保留或云服务器元数据地址（包括 IPv4 映射到 IPv6 的写法），就拒绝投递，并且只连接检查过的那个地址。局域网模式允许内网和本机地址，只挡掉元数据、组播、广播和未指定地址。
