<div align="center">

<img src="assets/brand-poster.png" alt="虾扯蛋品牌海报：有事说事，没事虾扯蛋" width="880" />

# 虾扯蛋

**有事说事，没事虾扯蛋。**

开源私有化轻量协作聊天空间，内置持续拓展的好友**游戏厅**。<br />
单文件 SQLite 零外部数据库，支持 macOS / Windows 桌面端、Web / PWA 与 Android / iOS 客户端。

[![Build and Release](https://github.com/ayogggua/xiachedan/actions/workflows/build.yml/badge.svg)](https://github.com/ayogggua/xiachedan/actions/workflows/build.yml)
[![Releases](https://img.shields.io/github/v/release/ayogggua/xiachedan?label=Release&color=c95a36)](https://github.com/ayogggua/xiachedan/releases)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.13-2d6a4f)](package.json)
[![License](https://img.shields.io/badge/License-MIT-caa860)](LICENSE)

<p>
  <strong>简体中文</strong> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-TW.md">繁體中文</a>
</p>

[核心亮点](#核心亮点) · [游戏厅](#游戏厅持续拓展的互动空间) · [界面预览](#界面预览) · [聊天与协作](#聊天与协作能力) · [快速自托管部署](#快速自托管部署) · [客户端打包](#客户端开发与打包) · [项目结构](#项目结构)

</div>

---

## 核心亮点

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>克隆即部署，零外部数据库</strong><br />
      后端基于 Node.js 原生 <code>node:sqlite</code>，消息、好友关系、筹码账户与战绩全部落在单个 SQLite 文件中，附件直存本地目录。无需安装 MySQL、PostgreSQL 或 Redis，几分钟就能部署到自己的服务器或局域网主机。
    </td>
    <td width="50%" valign="top">
      <strong>聊天与游戏厅原生融合</strong><br />
      日常沟通与下班开局共用同一套账号、好友关系与 WebSocket 实时连接。游戏期间持续接收聊天消息，牌桌邀请直接在聊天界面顶部实时弹出，关闭游戏厅无缝回到原会话与草稿。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>面向多应用拓展的游戏厅</strong><br />
      二级目录架构（全部游戏 → 房间大厅 → 实时对局），首发暗绿绒俱乐部<b>无限注德州扑克</b>。统一沉淀虚拟筹码银行、好友转账、排行榜与实时邀请底座，后续将持续拓展更多休闲桌游与好友互动应用。
    </td>
    <td width="50%" valign="top">
      <strong>克制耐看的全端体验</strong><br />
      提供<b>液态玻璃</b>与<b>经典三栏</b>双界面风格，支持浅色 / 深色 / 跟随系统。覆盖 macOS / Windows（Tauri 2）、Web / PWA（支持 Web Push 推送与系统分享）以及 Android / iOS（Capacitor）。
    </td>
  </tr>
</table>

> 桌面端与 Android 安装包可直接前往 [Releases](https://github.com/ayogggua/xiachedan/releases) 下载；如果你想自己搭一套私有空间，直接跳到 [快速自托管部署](#快速自托管部署)。

---

## 游戏厅：持续拓展的互动空间

游戏厅是虾扯蛋的重点互动模块，以独立街机图标常驻界面角落（桌面液态玻璃位于左下角设置旁、经典布局位于左侧导航栏下方、手机位于消息页右上角及「我」页面），在不打扰默认聊天流程的前提下随时一键进入。

### 可拓展的应用底座

- **两级目录卡片架构**：进入游戏厅先展示「全部游戏」目录卡片，点击进入对应应用的房间列表与实时对局。后续新增休闲桌游或好友互动应用时，直接以新卡片接入目录，沿用同一套空间连接与交互规范。
- **持久化虚拟筹码银行**：每位成员默认拥有 **200,000** 初始虚拟筹码，账户余额、牌桌托管筹码与完整流水均持久化保存在 SQLite（`server/arcadeBank.js`）。支持**好友间互转筹码**与总管理员发放筹码；服务重启时自动退回未完成牌局的托管筹码，不会吞币。
- **多维度排行榜与战绩卡**：支持按**净赢、总筹码、胜率、牌局数、累计赢得**切换排序；点击任意玩家展开完整数据卡（累计赢得 / 投入、最大单局净赢、主动入池率 VPIP、加注局数、全下 / 摊牌 / 弃牌 / 平分底池与最长连胜）。
- **站内实时邀请**：在房间内一键邀请好友，对方在聊天窗口顶部立即收到邀请卡片并一键入座；游戏与聊天共享实时连接，对局期间照常接收聊天消息，退出游戏厅即回到原会话与未发送草稿。

### 首发应用：无限注德州扑克（暗绿绒俱乐部）

- **俱乐部级视觉与物理手感**：暗绿绒牌桌、胡桃木缝线桌沿、精工黄铜发牌靴与机械计数器、雕花牌背与精绘人头牌；内置刚体筹码抛投物理动效与空间实录音效（可独立开关）。
- **底牌防窥盖牌**：单击自己的任意底牌即可盖牌防窥，长按临时偷看、松手自动扣回；顶栏提供持久化防窥开关，开启后每局默认盖牌、摊牌时自动亮牌。
- **服务端权威规则引擎**：支持 2–6 人无限注，开桌或局间可自定义**底分（小盲 1–1,000,000）**与**每场手数（0 为不限）**；服务端统一处理密码学洗牌、最小加注、全下边池、平分底池与无人跟注筹码返还，他人底牌仅在摊牌时下发。
- **流畅的多人局节奏**：40 秒行动倒计时与超时自动托管、5 秒自动连开下一手、实时观战、中途入座下一手自动参与、局中支持预约「本局后离桌」或立即离桌（结算后自动退回筹码），内置牌桌聊天气泡。

| 应用模块 | 当前状态 | 能力说明 |
| --- | --- | --- |
| **无限注德州扑克** | 已上线 | 2–6 人暗绿绒俱乐部、防窥盖牌、刚体筹码、空间音效、战绩排行 |
| **更多休闲桌游** | 持续拓展中 | 直接接入游戏厅目录卡片，复用房间、观战、邀请与筹码系统 |
| **好友互动小应用** | 持续拓展中 | 与聊天空间共用账号与好友关系，打造轻量团队 / 好友互动合集 |

> **说明**：虚拟筹码仅供娱乐，不可充值、交易或兑换。筹码余额、流水与战绩持久化存储于 SQLite；进行中的实时牌桌状态保存在服务进程内存中，服务重启后会清空牌桌并将未完成牌局的托管筹码自动退回各玩家账户。所有参局客户端须连接同一服务进程，暂不支持多实例共享牌桌。

---

## 界面预览

### 游戏厅 · 暗绿绒德州扑克俱乐部

![游戏厅德州扑克暗绿绒俱乐部：六人牌桌、公共牌、筹码堆、行动控制条与本局记录](assets/screenshot-poker.png)

### 游戏厅 · 可拓展应用目录

![游戏厅全部游戏目录：德州扑克卡片、虚拟筹码余额与已入座状态](assets/screenshot-arcade.png)

### 液态玻璃聊天界面与实时牌桌邀请

![虾扯蛋液态玻璃聊天界面：浮动玻璃侧栏、引用与回应消息、左下角游戏厅入口及右上角实时牌桌邀请](assets/screenshot-chat.png)

> 设置中可随时在「虾扯蛋」（液态玻璃）与「经典」（左侧导航 + 会话列表 + 聊天区三栏）风格间切换；窄屏与移动端自动切换为消息、通讯录、我三级布局。

---

## 聊天与协作能力

<details open>
<summary><strong>好友关系与私密边界</strong></summary>

- **好友申请制**：通讯录默认仅展示好友，支持通过昵称、完整手机号或邮箱搜索并发送好友申请，添加后可发起私聊、邀请进群与互转游戏筹码；普通成员不暴露全站用户列表，仅管理员可查看完整用户目录。
- **可控公共大厅**：新成员注册审核通过后不再自动加入公共大厅，大厅成员由管理员主动邀请或移除。
- **个人资料与状态**：支持自定义昵称、头像裁剪、名字颜色、部门、签名、备注（仅自己可见），以及可设定自动过期时间的自定义状态。

</details>

<details open>
<summary><strong>会话组织与高效检索</strong></summary>

- **多类型会话**：公共大厅、群聊、一对一私聊，WebSocket 实时收发，断线重连后自动补齐遗漏消息。
- **完整群管理**：群主转让、最多 10 位群管理员、群头像、群公告、全员禁言、群昵称、移出成员，以及可配置是否审批的邀请链接。
- **秩序与效率**：会话置顶拖拽排序、免打扰、标为已读 / 未读、跨设备同步自定义文件夹、按会话设置消息自动销毁周期（1 天 / 1 周 / 1 个月）、草稿标记、`⌘K` 快速切换、`⌘1–9` 跳转、`⌘/` 查看快捷键。
- **定位与归档**：全局多条件搜索（按发送人 / 类型 / 时间过滤并直达原消息）、「提到我的」汇总、按日期跳转、会话置顶消息、话题回复、收藏、定时发送、「提醒我」、媒体文件汇总，桌面端支持将单个会话弹出为独立窗口。

</details>

<details>
<summary><strong>富消息表达与互动（点击展开）</strong></summary>

- **多媒体与预览**：文字、图片（支持原图 / 压缩、裁剪与画笔标注、相册网格、全屏缩放翻看）、视频、普通文件；文本、代码与 PDF 支持直接预览。
- **完整 Markdown**：标题、表格、待办、列表、引用、代码块语法高亮与一键复制；输入 `/` 快速插入格式，粘贴网页或文档富文本自动转为 Markdown；支持切换 `Enter` 或 `⌘Enter` 发送。
- **引用、剧透与阅后即焚**：支持选中片段引用回复、`@成员` / `@所有人`；文字用 `||内容||` 或发图 / 视频前标记为剧透（通知、预览、搜索与导出均不泄露）；私聊支持 5 秒–1 分钟阅后即焚（对方点开后倒计时，到期正文与附件从服务端销毁，不可引用 / 转发 / 收藏 / 复制 / 下载）。
- **轻量协作互动**：消息编辑与历史记录、粉碎动画撤回与重新编辑、投票、群接龙、链接预览、拍一拍、推荐名片、复制消息直达链接、任意表情回应（气泡内展示回应者头像，双击点赞）、收藏图片为表情及 `:shortcode:` 短码、跨设备常用语、多选逐条 / 合并转发（单次最多 100 条、9 个会话）、断网离线队列自动重发、导出聊天记录为文本。

</details>

<details>
<summary><strong>外观、隐私、移动端与机器人（点击展开）</strong></summary>

- **界面与隐私**：液态玻璃与经典三栏双风格，浅色 / 深色 / 跟随系统，每种风格独立记忆主题色与聊天背景（6 种内置或自定义图片）；隐私模式隐藏消息内容、悬停才显示并计为已读；桌面端与 HTTPS 网页支持本机应用锁密码；应用开屏动画支持跳过及遵循系统减少动态效果。
- **桌面与移动能力**：桌面端支持菜单栏 / 托盘常驻、系统通知直达会话、提示音、关键词提醒、勿扰时段、Dock 未读数与原生右键菜单；PWA 在 HTTPS 下支持主屏幕安装、Web Push 后台推送与 Android Chrome 系统分享接收；Android 原生客户端支持附件下载与系统分享。
- **管理与机器人**：管理员审核注册、重置密码、禁言成员、删除消息、设置保留期限与撤回时限、查看存储占用与操作日志，成员可查看并下线自己的登录设备；支持群 Webhook 机器人及独立机器人账号（签名 JSON 回调 + 令牌回复），接入文档见 [`docs/bots.md`](docs/bots.md)。

</details>

---

## 快速自托管部署

克隆仓库后，根据你的使用场景选择最合适的方式即可部署上线：

| 部署方式 | 适用场景 | 外部依赖 | 预计耗时 |
| --- | --- | --- | --- |
| **方式一：本地 / 局域网模式（Local）** | 办公室、宿舍、家庭内网快速体验，免注册邀请码加入 | Node.js ≥ 22.13 | 1 分钟 |
| **方式二：单机公网自托管（Cloud + Node.js）** | 一台轻量云主机直接运行，账号审核登录，前后端一体 | Node.js ≥ 22.13 + Nginx / Caddy | 3 分钟 |
| **方式三：Docker + Nginx 生产部署** | 长期公网运行、容器隔离、前后端分离与原子切换 | Docker + Nginx | 5 分钟 |

### 0. 克隆仓库

```bash
git clone https://github.com/ayogggua/xiachedan.git
cd xiachedan
```

---

### 方式一：本地 / 局域网快速体验（零配置）

需要 **Node.js 22.13.0 或以上**与 npm：

```bash
npm ci
npm run build
CHAT_MODE=local CHAT_SERVE_WEB=true npm start
```

启动后终端会输出包含 `#setup=...` 的本机初始化链接（默认端口 `4318`）：

1. 在运行服务的电脑浏览器中打开该链接，创建空间与管理员昵称。
2. 在应用内复制局域网地址与邀请码发给同一局域网的朋友，对方在浏览器中打开即可加入聊天和游戏厅。

---

### 方式二：单机公网自托管（Cloud 账号模式 · 推荐个人 / 小团队）

正式公网服务采用手机号 / 邮箱 + 密码登录，新成员注册需经管理员审核。

#### 1. 修改初始超级管理员手机号（强烈建议）

打开 [`server/auth.js`](server/auth.js) 第 8 行，将 `ADMIN_PHONE` 改成你自己的手机号（用于首次初始化超级管理员账号）：

```js
const ADMIN_PHONE = '13800138000';
```

#### 2. 准备首次启动的管理员初始密码文件

将 10–128 位、同时包含字母和数字的初始密码写入仓库外的文件（初始化完成后，后续重启不再需要该文件）：

```bash
mkdir -p /etc/xiachedan
printf '%s\n' 'YourStrongPass2026' > /etc/xiachedan/admin-password
chmod 600 /etc/xiachedan/admin-password
```

#### 3. 安装依赖并构建前端（含 PWA 支持）

```bash
npm ci
npm run build:pwa
```

#### 4. 启动服务

**生产 HTTPS 环境**（配合下方 Nginx / Caddy 反向代理使用）：

```bash
NODE_ENV=production \
CHAT_MODE=cloud \
CHAT_SERVE_WEB=true \
HOST=127.0.0.1 \
PORT=4318 \
CHAT_DATA_DIR=/var/lib/xiachedan \
CHAT_SPACE_NAME=虾扯蛋 \
CHAT_PUBLIC_URL=https://chat.example.com \
CHAT_ALLOWED_ORIGINS=https://chat.example.com \
CHAT_TRUST_PROXY=1 \
CHAT_ADMIN_PASSWORD_FILE=/etc/xiachedan/admin-password \
npm start
```

> **本地 HTTP 预览账号模式？** `NODE_ENV=production` 会强制启用 `__Host-` + `Secure` Cookie（仅限 HTTPS）。如果在本地 `127.0.0.1` 用 HTTP 预览，去掉 `NODE_ENV=production` 和 `CHAT_TRUST_PROXY` 即可：
> ```bash
> CHAT_MODE=cloud CHAT_SERVE_WEB=true \
> CHAT_PUBLIC_URL=http://127.0.0.1:4318 \
> CHAT_ALLOWED_ORIGINS=http://127.0.0.1:4318 \
> CHAT_ADMIN_PASSWORD_FILE=/path/to/admin-password.txt \
> npm start
> ```

#### 5. 配置 HTTPS 反向代理（以 Caddy 或 Nginx 为例）

后端同时提供 HTTP API（`/api/`）与 WebSocket（`/socket`），反代务必放行大附件上传并开启 WebSocket 升级。

<details>
<summary><strong>使用 Caddy（最简，自动申请 HTTPS 证书）</strong></summary>

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:4318
}
```

</details>

<details>
<summary><strong>使用 Nginx（关键配置片段）</strong></summary>

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;
    # ssl_certificate / ssl_certificate_key 替换为你的证书路径
    client_max_body_size 101m;

    location = /socket {
        proxy_pass http://127.0.0.1:4318;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
    }

    location / {
        proxy_pass http://127.0.0.1:4318;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 90s;
    }
}
```

</details>

#### 6. 验证上线与首次登录

```bash
curl -s https://chat.example.com/api/health
# 返回 {"app":"linliao","version":"...","mode":"cloud","ok":true,...} 即运行正常
```

在浏览器打开 `https://chat.example.com`，用设置的 `ADMIN_PHONE` 和初始密码登录，按提示修改密码后即可进入空间。此后朋友注册账号，你在「设置 → 账号管理」中通过审核即可一起聊天与进游戏厅。

> 长期运行建议使用 `systemd` 或 `pm2` 托管 `node server/index.js` 进程。

---

### 方式三：Docker + Nginx 生产前后端分离部署

仓库 [`deploy/`](deploy/) 目录已内置完整的最小权限 Docker 容器配置与硬化 Nginx 配置，前后端可独立升级：

1. **按需修改 [`server/auth.js`](server/auth.js) 中的 `ADMIN_PHONE`**，然后构建后端镜像：
   ```bash
   docker build -f deploy/Dockerfile.backend -t xiachedan-backend:latest .
   ```
2. **准备宿主机配置、密钥与数据目录**（容器以 `uid 1000` 的 `node` 用户只读运行）：
   ```bash
   sudo mkdir -p /etc/xiachedan /var/lib/xiachedan /opt/xiachedan/frontend/current
   sudo cp deploy/backend.env.example /etc/xiachedan/backend.env
   # 编辑 /etc/xiachedan/backend.env，将 chat.example.com 替换为你的正式域名
   printf '%s\n' 'YourStrongPass2026' | sudo tee /etc/xiachedan/admin-password >/dev/null
   sudo chmod 600 /etc/xiachedan/admin-password
   sudo chown -R 1000:1000 /var/lib/xiachedan
   ```
3. **启动后端容器**：
   ```bash
   BACKEND_IMAGE=xiachedan-backend:latest RELEASE_SHA=local \
     docker compose -f deploy/compose.yml up -d
   ```
4. **构建并托管 PWA 前端静态文件**：
   ```bash
   npm ci && npm run build:pwa
   sudo cp -r dist/* /opt/xiachedan/frontend/current/
   ```
5. **套用 [`deploy/nginx.conf`](deploy/nginx.conf)**：将配置中的 `chat.example.com`（含 `Content-Security-Policy` 中的 `wss://chat.example.com`）与 SSL 证书路径替换为你的实际域名与证书路径后重载 Nginx。

---

### 环境变量速查

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CHAT_MODE` | `local`（`NODE_ENV=production` 时为 `cloud`） | 运行模式：`cloud`（账号审核模式）或 `local`（局域网邀请码模式） |
| `NODE_ENV` | — | 设为 `production` 时启用 HTTPS-only 安全 Cookie（`__Host-xiachedan_session`）与严格来源校验 |
| `CHAT_SERVE_WEB` | `local` 模式为 `true`，`cloud` 为 `false` | 是否由 Node 服务端直接托管 `dist/` 前端静态资源（单机一体部署请设为 `true`） |
| `HOST` / `PORT` | `0.0.0.0` / `4318` | 监听地址与端口；前有 Nginx 反代时建议设 `HOST=127.0.0.1` |
| `CHAT_DATA_DIR` | `./.data` | SQLite 数据库与附件存储目录 |
| `CHAT_SPACE_NAME` | `虾扯蛋` | 首次初始化时的空间名称（最多 32 字） |
| `CHAT_PUBLIC_URL` | — | 对外正式根地址（不带末尾 `/`），生产模式必填且须包含在 `CHAT_ALLOWED_ORIGINS` 中 |
| `CHAT_ALLOWED_ORIGINS` | 同 `CHAT_PUBLIC_URL` | 允许访问的精确 Origin，多个用逗号分隔 |
| `CHAT_TRUST_PROXY` | — | 反向代理跳数或可信 IP（经过一层 Nginx / Caddy 时设为 `1`） |
| `CHAT_COOKIE_SAME_SITE` | `lax` | 会话 Cookie 的 `SameSite` 策略（`lax` / `strict` / `none`） |
| `CHAT_ADMIN_PASSWORD_FILE` | — | 首次初始化超管密码的文件路径（优先于 `CHAT_ADMIN_INITIAL_PASSWORD`） |
| `CHAT_LINK_PREVIEW` | 开启 | 设为 `off` 关闭链接预览（服务端仅请求公网地址，不抓取图片） |
| `CHAT_MAX_STORAGE_BYTES` | `10737418240`（10 GB） | 空间附件总容量上限（字节） |
| `CHAT_MAX_USER_BYTES` | 不限制 | 每位成员的附件容量上限（字节） |

### 数据目录与备份

- **网页 / 自托管服务端**：默认位于 `./.data/`（或 `CHAT_DATA_DIR` 指定路径，Docker 默认 `/var/lib/xiachedan`）。
- **桌面端本地空间**：macOS 为 `~/Library/Application Support/邻聊/space/`，Windows 为 `%APPDATA%\邻聊\space\`。
- **安全备份**：请先停止服务或退出桌面应用，再打包复制整个数据目录（含 `chat.sqlite*` 与附件文件夹）。

---

## 客户端开发与打包

你可以将桌面端与移动端直接绑定到自己的自托管服务器地址。

### macOS / Windows 桌面端（Tauri 2）

需要安装 [Rust](https://www.rust-lang.org/tools/install)（1.90+）；macOS 需 Xcode 命令行工具，Windows 需 Visual Studio C++ 生成工具与 WebView2（Windows 11 已预装）。

```bash
# 本地桌面开发（首次运行会自动下载校验官方 Node.js 运行时）
npm run desktop

# 打包并绑定到你的自建 HTTPS 服务
LINLIAO_CLOUD_URL=https://chat.example.com npm run package:mac
LINLIAO_CLOUD_URL=https://chat.example.com npm run package:win
```

产物位于 `src-tauri/target/release/bundle/`。若不设置 `LINLIAO_CLOUD_URL`，默认打包为局域网模式。macOS 本地打包使用临时签名，不含 Apple 公证；交叉构建其他架构可先准备对应运行时：

```bash
npm run build
node scripts/prepare-desktop.mjs x86_64-apple-darwin
npx tauri build --target x86_64-apple-darwin --bundles app,dmg
```

### PWA 与手机推送

使用 `npm run build:pwa` 构建（仅运行 `npm run build` 不会生成应用清单和 Service Worker），部署到 HTTPS 域名后：

- **iPhone / iPad**：Safari 打开域名 → 分享 → 添加到主屏幕。
- **Android**：Chrome 打开域名 → 安装应用，支持系统分享菜单直接分享图片和文件到会话。
- **Web Push 推送**：登录后在设置中开启「手机推送」并授予通知权限，服务端首次使用时自动生成推送签名密钥。

### Android / iOS 原生客户端（Capacitor）

Android 打包需要 JDK 21、Android SDK 36 与 Build Tools 36.0.0：

```bash
# 打包指向你自建服务的 Android APK
VITE_API_BASE_URL=https://chat.example.com npm run package:android
```

产物输出在 `release/xiachedan-mobile-<版本号>-debug.apk`。也可以运行 `npm run mobile:android` 或 `npm run mobile:ios` 分别在 Android Studio / Xcode 中打开原生工程（iOS 真机分发需自行配置 Apple 签名；当前手机后台推送仅用于 PWA）。

---

## 自动构建与发布

仓库在 `.github/workflows/` 提供四条独立工作流，按变更路径自动触发，也支持在 Actions 页面手动运行：

| 工作流 | 用途与产物 |
| --- | --- |
| [Build Desktop](.github/workflows/build.yml) | 代码检查、测试与构建，产出 macOS arm64 / x64 与 Windows x64 安装包及签名更新清单 |
| [Build Android](.github/workflows/build-mobile.yml) | 构建 `xiachedan-android` APK，通过 `mobile-v<版本号>` 标签或手动触发发布预发布包 |
| [Deploy Web and PWA](.github/workflows/deploy-frontend.yml) | 构建 `production-web`，配置部署变量后自动发布网页与 PWA |
| [Deploy Backend](.github/workflows/deploy-backend.yml) | 独立检查并部署后端服务 |

- 桌面发布版本以 Git 标签为准，正式发布需配置 `CHAT_PUBLIC_URL`、`TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_UPDATER_PUBKEY`；Android 体验包保持签名一致需配置 `ANDROID_DEBUG_KEYSTORE`。
- 仅修改 `README.md` 与 `assets/` 不会触发上述自动构建与部署流程。

---

## 项目结构

| 目录 / 文件 | 内容说明 |
| --- | --- |
| `src/` | React 19 前端界面、聊天交互、液态玻璃 / 经典双风格、好友系统、移动端与 PWA |
| `src/arcade/` | 游戏厅核心模块：两级游戏目录（`ArcadeLobby.jsx`）、排行榜与筹码钱包面板（`ArcadePanels.jsx`）、暗绿绒德州扑克牌桌（`Arcade.jsx`）、刚体筹码物理与空间音效 |
| `src/ArcadeEntry.jsx` / `ArcadeInvitation.jsx` | 游戏厅街机入口按钮与聊天内实时牌桌邀请浮条 |
| `src/Opening.jsx` | 应用启动开屏动画 |
| `server/` | Express 5、WebSocket 服务、账号鉴权（`auth.js`）、SQLite 存储（`store.js`）、Web Push 与机器人投递 |
| `server/poker.js` / `arcadeBank.js` | 德州扑克权威规则引擎与持久化虚拟筹码 / 战绩银行 |
| `src-tauri/` | Tauri 2 桌面外壳：内置 Node sidecar、菜单栏 / 托盘、系统通知与 `window.desktop` 桥接 |
| `mobile/` | Capacitor Android 与 iOS 原生工程 |
| `deploy/` | 生产环境 Docker 后端镜像、Compose 编排、Nginx 硬化配置与原子发布脚本 |
| `scripts/` | 桌面运行时准备、版本解析、更新清单、PWA 与移动端构建脚本 |
| `shared/` | 邀请码解析、预设头像等前后端共用逻辑 |
| `docs/bots.md` | 机器人账号与回调接口开发文档 |
| `tests/` | 服务端自动化测试（`npm test`，覆盖局域网、账号、好友与游戏厅模式） |
| `assets/` | README 品牌海报与界面截图 |

---

## 使用与安全范围

- 局域网模式使用 HTTP / WebSocket，适用于可信内网；公网部署请始终使用 `cloud` 账号模式并通过 HTTPS / WSS 反向代理访问。
- 两种模式均未实现端到端加密（E2EE），聊天记录、附件与游戏筹码数据保存在空间主机或自托管服务器上；隐私模式与应用锁仅控制本机界面访问，不加密本机磁盘数据。
- 私聊阅后即焚会在倒计时结束后从服务端删除正文与附件，但无法阻止对方截屏、录屏或使用其他设备拍摄屏幕。

## 开源许可

本项目采用 [MIT License](LICENSE) 开源。欢迎提交 Issue 反馈问题、提出你想在**游戏厅**里玩到的新应用，或通过 Pull Request 一起完善虾扯蛋。
