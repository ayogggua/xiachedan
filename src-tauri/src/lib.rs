mod probe;
mod server;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, State, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";
const SEEN_LIMIT: usize = 2000;

#[derive(Default, Serialize, Deserialize)]
struct Config {
  #[serde(skip_serializing_if = "Option::is_none")]
  server: Option<String>,
  #[serde(rename = "privateMode", skip_serializing_if = "Option::is_none")]
  private_mode: Option<bool>,
  #[serde(rename = "notificationsEnabled", skip_serializing_if = "Option::is_none")]
  notifications_enabled: Option<bool>,
}

#[derive(Default)]
struct Session {
  config: Config,
  active_origin: String,
  renderer_ready: bool,
  pending_room: Option<String>,
  current_room: Option<String>,
  unread: HashSet<String>,
  seen: VecDeque<String>,
  notification_rooms: HashMap<i32, String>,
  notification_error: String,
  connecting: bool,
}

struct Desktop {
  config_path: PathBuf,
  session: Mutex<Session>,
  local: Mutex<Option<server::LocalServer>>,
  quitting: AtomicBool,
  next_notification: AtomicI32,
  tray: Mutex<Option<TrayIcon>>,
}

type Shared<'a> = State<'a, Arc<Desktop>>;

fn valid_id(value: &str) -> bool {
  !value.is_empty() && value.len() <= 200
}

impl Desktop {
  fn save(&self, session: &Session) {
    if let Ok(text) = serde_json::to_string(&session.config) {
      let temporary = self.config_path.with_extension("json.tmp");
      if std::fs::write(&temporary, text).is_ok() {
        let _ = std::fs::rename(&temporary, &self.config_path);
      }
    }
  }

  fn state(&self, app: &AppHandle) -> Value {
    let session = self.session.lock().unwrap();
    json!({
      "privateMode": session.config.private_mode != Some(false),
      "notificationsEnabled": session.config.notifications_enabled != Some(false),
      "notificationSupported": true,
      "notificationError": session.notification_error,
      "active": is_active(app),
    })
  }

  fn local_address(&self) -> Option<(String, String)> {
    self.local.lock().unwrap().as_ref().map(|local| (local.address.clone(), local.setup_url.clone()))
  }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
  app.get_webview_window(MAIN)
}

fn is_active(app: &AppHandle) -> bool {
  main_window(app).is_some_and(|window| window.is_visible().unwrap_or(false)
    && window.is_focused().unwrap_or(false) && !window.is_minimized().unwrap_or(false))
}

// 主进程 → 页面：通过注入脚本暴露的分发函数投递事件。
fn emit(app: &AppHandle, desktop: &Desktop, kind: &str, mut data: Value) {
  if !desktop.session.lock().unwrap().renderer_ready { return }
  if let (Some(window), Some(object)) = (main_window(app), data.as_object_mut()) {
    object.insert("type".into(), json!(kind));
    let _ = window.eval(format!("window.__linliaoDesktopEmit && window.__linliaoDesktopEmit({data})"));
  }
}

fn require_trusted(webview: &Webview, desktop: &Desktop) -> Result<(), String> {
  let origin = desktop.session.lock().unwrap().active_origin.clone();
  match webview.url() {
    Ok(url) if webview.label() == MAIN && probe::same_origin(url.as_str(), &origin) => Ok(()),
    _ => Err("请求来源无效".into()),
  }
}

fn open_address(app: &AppHandle, desktop: &Desktop, origin: &str, fragment: Option<String>) -> Result<(), String> {
  let local = desktop.local_address();
  let target = match (&local, fragment) {
    (_, Some(fragment)) => format!("{origin}/#{fragment}"),
    (Some((address, setup_url)), None) if address == origin => setup_url.clone(),
    _ => format!("{origin}/"),
  };
  {
    let mut session = desktop.session.lock().unwrap();
    session.active_origin = origin.to_string();
    session.renderer_ready = false;
    session.pending_room = None;
    session.current_room = None;
    session.unread.clear();
    session.seen.clear();
    session.config.server = Some(origin.to_string());
    desktop.save(&session);
  }
  render(app, desktop);
  let url = Url::parse(&target).map_err(|error| error.to_string())?;
  main_window(app).ok_or("窗口不可用")?.navigate(url).map_err(|error| error.to_string())
}

fn go_home(app: &AppHandle, desktop: &Desktop) {
  if let Some((address, _)) = desktop.local_address() {
    let _ = open_address(app, desktop, &address, None);
  }
}

fn show(app: &AppHandle, desktop: &Desktop, room: Option<String>) {
  let Some(window) = main_window(app) else { return };
  if let Some(room) = room.filter(|room| valid_id(room)) {
    let ready = desktop.session.lock().unwrap().renderer_ready;
    if ready { emit(app, desktop, "open-room", json!({ "roomId": room })); }
    else { desktop.session.lock().unwrap().pending_room = Some(room); }
  }
  let _ = window.unminimize();
  let _ = window.show();
  let _ = window.set_focus();
  emit(app, desktop, "visibility", json!({ "active": is_active(app) }));
}

fn render(app: &AppHandle, desktop: &Desktop) {
  let (count, private_mode, notifications) = {
    let session = desktop.session.lock().unwrap();
    (session.unread.len(), session.config.private_mode != Some(false), session.config.notifications_enabled != Some(false))
  };
  let Some(tray) = desktop.tray.lock().unwrap().clone() else { return };
  let badge = match count { 0 => None, 1..=99 => Some(count.to_string()), _ => Some("99+".into()) };
  #[cfg(target_os = "macos")]
  let _ = tray.set_title(badge.as_deref());
  let _ = tray.set_tooltip(Some(match &badge {
    Some(badge) => format!("虾扯蛋 · {badge} 个未读会话"),
    None => "虾扯蛋 · 点击打开聊天，右键查看设置".into(),
  }));
  if let Ok(menu) = tray_menu(app, count, private_mode, notifications) {
    let _ = tray.set_menu(Some(menu));
  }
}

fn tray_menu(app: &AppHandle, unread: usize, private_mode: bool, notifications: bool) -> tauri::Result<Menu<tauri::Wry>> {
  let open = if unread > 0 { format!("打开虾扯蛋（{unread} 个未读会话）") } else { "打开虾扯蛋".into() };
  let settings_label = if cfg!(target_os = "macos") { "macOS 通知设置…" } else { "系统通知设置…" };
  Menu::with_items(app, &[
    &MenuItem::with_id(app, "tray-open", open, true, None::<&str>)?,
    &PredefinedMenuItem::separator(app)?,
    &CheckMenuItem::with_id(app, "tray-privacy", "隐私模式", true, private_mode, None::<&str>)?,
    &CheckMenuItem::with_id(app, "tray-notifications", "新消息弹窗提醒", true, notifications, None::<&str>)?,
    &MenuItem::with_id(app, "tray-test", "发送测试提醒", notifications, None::<&str>)?,
    &MenuItem::with_id(app, "tray-settings", settings_label, true, None::<&str>)?,
    &PredefinedMenuItem::separator(app)?,
    &MenuItem::with_id(app, "home", "返回本机空间", true, None::<&str>)?,
    &MenuItem::with_id(app, "quit", "退出虾扯蛋", true, None::<&str>)?,
  ])
}

fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  Menu::with_items(app, &[
    &Submenu::with_items(app, "虾扯蛋", true, &[
      &PredefinedMenuItem::about(app, Some("关于虾扯蛋"), None)?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, "show", "显示虾扯蛋", true, None::<&str>)?,
      &MenuItem::with_id(app, "home", "返回本机空间", true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::hide(app, Some("隐藏虾扯蛋"))?,
      &PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?,
      &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, "quit", "退出虾扯蛋", true, Some("CmdOrCtrl+Q"))?,
    ])?,
    &Submenu::with_items(app, "编辑", true, &[
      &PredefinedMenuItem::undo(app, Some("撤销"))?,
      &PredefinedMenuItem::redo(app, Some("重做"))?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, Some("剪切"))?,
      &PredefinedMenuItem::copy(app, Some("复制"))?,
      &PredefinedMenuItem::paste(app, Some("粘贴"))?,
      &PredefinedMenuItem::select_all(app, Some("全选"))?,
    ])?,
    &Submenu::with_items(app, "窗口", true, &[
      &PredefinedMenuItem::minimize(app, Some("最小化"))?,
      &PredefinedMenuItem::maximize(app, Some("缩放"))?,
      &PredefinedMenuItem::fullscreen(app, Some("切换全屏"))?,
      &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
    ])?,
  ])
}

fn update_settings(app: &AppHandle, desktop: &Desktop, value: &Value) -> Result<Value, String> {
  let object = value.as_object().ok_or("设置无效")?;
  {
    let mut session = desktop.session.lock().unwrap();
    for key in ["privateMode", "notificationsEnabled"] {
      if let Some(entry) = object.get(key) {
        let flag = entry.as_bool().ok_or("设置无效")?;
        if key == "privateMode" { session.config.private_mode = Some(flag) } else { session.config.notifications_enabled = Some(flag) }
      }
    }
    desktop.save(&session);
  }
  render(app, desktop);
  let state = desktop.state(app);
  emit(app, desktop, "settings", state.clone());
  Ok(state)
}

fn notify(app: &AppHandle, desktop: &Desktop, room: &str, title: &str, body: &str) -> bool {
  let id = desktop.next_notification.fetch_add(1, Ordering::Relaxed);
  desktop.session.lock().unwrap().notification_rooms.insert(id, room.to_string());
  match app.notification().builder().id(id).title(title).body(body).show() {
    Ok(()) => { desktop.session.lock().unwrap().notification_error.clear(); true }
    Err(_) => {
      desktop.session.lock().unwrap().notification_error = "系统未能显示提醒，请检查系统的通知设置。".into();
      let state = desktop.state(app);
      emit(app, desktop, "settings", state);
      false
    }
  }
}

#[derive(Deserialize)]
struct Identity { name: String, avatar: String }

#[tauri::command]
async fn desktop_connect(app: AppHandle, webview: Webview, desktop: Shared<'_>, addresses: Vec<String>, invite_code: String, identity: Identity) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  {
    let mut session = desktop.session.lock().unwrap();
    if session.connecting { return Err("正在连接空间，请稍候".into()) }
    session.connecting = true;
  }
  let origins: Vec<String> = addresses.iter().filter_map(|address| probe::private_origin(address)).take(8).collect();
  let found = tauri::async_runtime::spawn_blocking(move || probe::first_healthy(origins)).await.ok().flatten();
  desktop.session.lock().unwrap().connecting = false;
  let origin = found.ok_or("无法连接，请确认两台电脑在同一局域网，且创建空间的电脑已打开虾扯蛋")?;
  let code: String = invite_code.chars().filter(|c| c.is_ascii_hexdigit()).take(12).collect::<String>().to_uppercase();
  let fragment = (code.len() == 12).then(|| {
    let join = json!({ "inviteCode": code, "name": identity.name.chars().take(24).collect::<String>(), "avatar": identity.avatar });
    format!("join={}", url::form_urlencoded::byte_serialize(join.to_string().as_bytes()).collect::<String>())
  });
  open_address(&app, &desktop, &origin, fragment)?;
  Ok(true)
}

#[tauri::command]
fn desktop_home(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  go_home(&app, &desktop);
  Ok(true)
}

#[tauri::command]
fn desktop_copy(app: AppHandle, webview: Webview, desktop: Shared<'_>, text: String) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  if text.len() > 100_000 { return Err("复制内容过长".into()) }
  app.clipboard().write_text(text).map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
fn desktop_ready(app: AppHandle, webview: Webview, desktop: Shared<'_>, private_mode: bool) -> Result<Value, String> {
  require_trusted(&webview, &desktop)?;
  let pending = {
    let mut session = desktop.session.lock().unwrap();
    if session.config.private_mode.is_none() { session.config.private_mode = Some(private_mode); desktop.save(&session); }
    session.renderer_ready = true;
    session.pending_room.take()
  };
  let mut state = desktop.state(&app);
  state["pendingRoom"] = json!(pending);
  Ok(state)
}

#[tauri::command]
fn desktop_state(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<Value, String> {
  require_trusted(&webview, &desktop)?;
  Ok(desktop.state(&app))
}

#[tauri::command]
fn desktop_settings(app: AppHandle, webview: Webview, desktop: Shared<'_>, value: Value) -> Result<Value, String> {
  require_trusted(&webview, &desktop)?;
  update_settings(&app, &desktop, &value)
}

#[derive(Deserialize)]
struct Activity {
  #[serde(rename = "currentRoomId")]
  current_room_id: Option<String>,
  #[serde(rename = "unreadRooms")]
  unread_rooms: Vec<String>,
}

#[tauri::command]
fn desktop_activity(app: AppHandle, webview: Webview, desktop: Shared<'_>, value: Activity) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  if value.unread_rooms.len() > 5000 || !value.unread_rooms.iter().all(|id| valid_id(id))
    || value.current_room_id.as_deref().is_some_and(|id| !valid_id(id)) {
    return Err("会话状态无效".into());
  }
  {
    let mut session = desktop.session.lock().unwrap();
    session.current_room = value.current_room_id;
    session.unread = value.unread_rooms.into_iter().collect();
  }
  render(&app, &desktop);
  Ok(true)
}

#[derive(Deserialize)]
struct Notice {
  id: String,
  #[serde(rename = "roomId")]
  room_id: String,
  title: String,
  body: String,
  #[serde(rename = "privateMode")]
  private_mode: Option<bool>,
}

#[tauri::command]
fn desktop_message(app: AppHandle, webview: Webview, desktop: Shared<'_>, value: Notice) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  if !valid_id(&value.id) || !valid_id(&value.room_id) || value.title.chars().count() > 120 || value.body.chars().count() > 240 {
    return Err("消息提醒无效".into());
  }
  let (enabled, private_mode) = {
    let mut session = desktop.session.lock().unwrap();
    if session.seen.contains(&value.id) { return Ok(false) }
    session.seen.push_back(value.id.clone());
    if session.seen.len() > SEEN_LIMIT { session.seen.pop_front(); }
    if is_active(&app) && session.current_room.as_deref() == Some(value.room_id.as_str()) { return Ok(false) }
    session.unread.insert(value.room_id.clone());
    // 两端都做遮挡；页面未声明隐私状态时按隐私处理。
    (session.config.notifications_enabled != Some(false), session.config.private_mode != Some(false) || value.private_mode != Some(false))
  };
  render(&app, &desktop);
  if !enabled { return Ok(false) }
  let (title, body) = if private_mode { ("虾扯蛋 · 新消息", "****") } else { (value.title.as_str(), value.body.as_str()) };
  Ok(notify(&app, &desktop, &value.room_id, if title.is_empty() { "虾扯蛋 · 新消息" } else { title }, body))
}

#[derive(Deserialize)]
struct Recalled { id: String, #[serde(rename = "roomId")] room_id: String }

// macOS 与 Windows 无法撤下已显示的系统通知，这里只校验参数以保持契约。
#[tauri::command]
fn desktop_recalled(webview: Webview, desktop: Shared<'_>, value: Recalled) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  if !valid_id(&value.id) || !valid_id(&value.room_id) { return Err("消息标识无效".into()) }
  Ok(true)
}

#[tauri::command]
fn desktop_history_cleared(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  desktop.session.lock().unwrap().unread.clear();
  render(&app, &desktop);
  Ok(true)
}

fn test_notification(app: &AppHandle, desktop: &Desktop) -> Result<bool, String> {
  let (enabled, private_mode) = {
    let session = desktop.session.lock().unwrap();
    (session.config.notifications_enabled != Some(false), session.config.private_mode != Some(false))
  };
  if !enabled { return Err("请先开启新消息提醒".into()) }
  let body = if private_mode { "****" } else { "收到新消息时，虾扯蛋会在这里提醒你。" };
  Ok(notify(app, desktop, "", "虾扯蛋 · 测试提醒", body))
}

#[tauri::command]
fn desktop_test_notification(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  test_notification(&app, &desktop)
}

fn open_notification_settings(app: &AppHandle) -> Result<(), String> {
  let target = if cfg!(target_os = "macos") { "x-apple.systempreferences:com.apple.Notifications-Settings.extension" } else { "ms-settings:notifications" };
  app.opener().open_url(target, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_notification_settings(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  open_notification_settings(&app)?;
  Ok(true)
}

// 系统材质：macOS 26 起用液态玻璃（更早版本由 Tauri 回退到侧栏毛玻璃），Windows 11 用 Mica、Windows 10 用 Acrylic。
// Windows 不会自动回退，必须按系统版本选择，否则透明窗口会是空白。
fn os_major_build() -> Option<(u32, u32)> {
  #[cfg(target_os = "macos")]
  let text = std::process::Command::new("sw_vers").arg("-productVersion").output().ok()?.stdout;
  #[cfg(windows)]
  let text = {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd").args(["/c", "ver"]).creation_flags(0x0800_0000).output().ok()?.stdout
  };
  #[cfg(not(any(target_os = "macos", windows)))]
  let text: Vec<u8> = Vec::new();
  let text = String::from_utf8_lossy(&text);
  let version = text.split(|c: char| !(c.is_ascii_digit() || c == '.')).find(|part| part.contains('.'))?;
  let numbers: Vec<u32> = version.split('.').filter_map(|n| n.parse().ok()).collect();
  Some((*numbers.first()?, numbers.get(2).copied().unwrap_or(0)))
}

fn material() -> (&'static str, Option<tauri::utils::config::WindowEffectsConfig>) {
  use tauri::window::Effect;
  let effects = |list: Vec<Effect>| Some(tauri::utils::config::WindowEffectsConfig { effects: list, ..Default::default() });
  match os_major_build() {
    Some((major, _)) if cfg!(target_os = "macos") && major >= 26 => ("liquid-glass", effects(vec![Effect::LiquidGlassRegular, Effect::Sidebar])),
    Some(_) if cfg!(target_os = "macos") => ("vibrancy", effects(vec![Effect::Sidebar])),
    Some((10, build)) if cfg!(windows) && build >= 22000 => ("mica", effects(vec![Effect::Mica])),
    Some((10, build)) if cfg!(windows) && build >= 17763 => ("acrylic", effects(vec![Effect::Acrylic])),
    _ => ("", None),
  }
}

// 系统 WebView 不支持 -webkit-app-region，拖动与双击标题区由注入脚本转到这里。
#[tauri::command]
fn desktop_drag(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  main_window(&app).ok_or("窗口不可用")?.start_dragging().map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
fn desktop_zoom(app: AppHandle, webview: Webview, desktop: Shared<'_>) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  let window = main_window(&app).ok_or("窗口不可用")?;
  let result = if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() };
  result.map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
fn desktop_appearance(app: AppHandle, webview: Webview, desktop: Shared<'_>, theme: String) -> Result<bool, String> {
  require_trusted(&webview, &desktop)?;
  let theme = match theme.as_str() { "light" => Some(tauri::Theme::Light), "dark" => Some(tauri::Theme::Dark), "system" => None, _ => return Err("外观无效".into()) };
  main_window(&app).ok_or("窗口不可用")?.set_theme(theme).map_err(|error| error.to_string())?;
  Ok(true)
}

fn bridge_script(material: &str) -> String {
  let invitation = include_str!("../../shared/invitation.js").replace("export function", "function");
  let platform = if cfg!(target_os = "windows") { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
  include_str!("bridge.js").replace("/*INVITATION*/", &invitation).replace("/*PLATFORM*/", platform).replace("/*MATERIAL*/", material)
}

fn create_window(app: &AppHandle, desktop: Arc<Desktop>, start: Url) -> tauri::Result<WebviewWindow> {
  let navigation = desktop.clone();
  let (material, effects) = material();
  let builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(start))
    .title("虾扯蛋")
    .inner_size(1260.0, 830.0)
    .min_inner_size(800.0, 650.0)
    .background_color(if effects.is_some() { tauri::window::Color(0, 0, 0, 0) } else { tauri::window::Color(28, 28, 30, 255) })
    .transparent(effects.is_some())
    .initialization_script(bridge_script(material))
    // 只允许停留在当前空间的地址上，其他跳转一律拦截。
    .on_navigation(move |url| {
      let origin = navigation.session.lock().unwrap().active_origin.clone();
      probe::same_origin(url.as_str(), &origin)
    })
    .visible(false);
  let builder = match effects { Some(effects) => builder.effects(effects), None => builder };
  #[cfg(target_os = "macos")]
  let builder = builder
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .traffic_light_position(tauri::LogicalPosition::new(20.0, 20.0));
  builder.build()
}

fn initial_origin(desktop: &Desktop) -> Option<String> {
  let saved = desktop.session.lock().unwrap().config.server.clone();
  let local = desktop.local_address().map(|(address, _)| address);
  match saved {
    Some(saved) if Some(&saved) != local.as_ref() && probe::private_origin(&format!("{saved}/")).is_some() && probe::healthy(&saved) => Some(saved),
    _ => local,
  }
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      let desktop = app.state::<Arc<Desktop>>();
      show(app, &desktop, None);
    }))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      desktop_connect, desktop_home, desktop_copy, desktop_ready, desktop_state, desktop_settings, desktop_activity,
      desktop_message, desktop_recalled, desktop_history_cleared, desktop_test_notification, desktop_notification_settings, desktop_appearance, desktop_drag, desktop_zoom
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      // 与 Electron 版共用数据目录，升级后保留空间、身份和聊天记录；LINLIAO_DATA_DIR 供测试隔离使用。
      let root = match std::env::var_os("LINLIAO_DATA_DIR") { Some(dir) => PathBuf::from(dir), None => app.path().data_dir()?.join("邻聊") };
      std::fs::create_dir_all(&root)?;
      let config_path = root.join("desktop.json");
      let config = std::fs::read_to_string(&config_path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
      let node = std::env::current_exe()?.with_file_name(if cfg!(windows) { "node.exe" } else { "node" });
      let script = app.path().resource_dir()?.join("app").join("server").join("index.js");
      let local = server::start(&node, &script, &root.join("space")).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
      let desktop = Arc::new(Desktop {
        config_path,
        session: Mutex::new(Session { config, ..Default::default() }),
        local: Mutex::new(Some(local)),
        quitting: AtomicBool::new(false),
        next_notification: AtomicI32::new(1),
        tray: Mutex::new(None),
      });
      app.manage(desktop.clone());
      app.set_menu(app_menu(&handle)?)?;
      app.on_menu_event(|app, event| {
        let desktop = app.state::<Arc<Desktop>>();
        match event.id().as_ref() {
          "show" | "tray-open" => show(app, &desktop, None),
          "home" => { go_home(app, &desktop); show(app, &desktop, None); }
          "quit" => { desktop.quitting.store(true, Ordering::Relaxed); app.exit(0); }
          "tray-privacy" => { let next = desktop.session.lock().unwrap().config.private_mode == Some(false); let _ = update_settings(app, &desktop, &json!({ "privateMode": next })); }
          "tray-notifications" => { let next = desktop.session.lock().unwrap().config.notifications_enabled == Some(false); let _ = update_settings(app, &desktop, &json!({ "notificationsEnabled": next })); }
          "tray-test" => { let _ = test_notification(app, &desktop); }
          "tray-settings" => { let _ = open_notification_settings(app); }
          _ => {}
        }
      });
      let tray = TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            let app = tray.app_handle();
            let desktop = app.state::<Arc<Desktop>>();
            if is_active(app) { if let Some(window) = main_window(app) { let _ = window.hide(); } } else { show(app, &desktop, None); }
          }
        })
        .build(app)?;
      *desktop.tray.lock().unwrap() = Some(tray);
      let clicked = handle.clone();
      app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" { return }
        let desktop = clicked.state::<Arc<Desktop>>();
        let room = performed.notification().and_then(|notification| desktop.session.lock().unwrap().notification_rooms.get(&notification.id()).cloned());
        show(&clicked, &desktop, room.filter(|room| !room.is_empty()));
      })?;
      let origin = initial_origin(&desktop).ok_or("本机服务不可用")?;
      let start = {
        let local = desktop.local_address();
        let mut session = desktop.session.lock().unwrap();
        session.active_origin = origin.clone();
        session.config.server = Some(origin.clone());
        desktop.save(&session);
        match local { Some((address, setup_url)) if address == origin => setup_url, _ => format!("{origin}/") }
      };
      let window = create_window(&handle, desktop.clone(), Url::parse(&start)?)?;
      let events = handle.clone();
      window.on_window_event(move |event| {
        let desktop = events.state::<Arc<Desktop>>();
        match event {
          WindowEvent::Focused(_) | WindowEvent::Resized(_) => emit(&events, &desktop, "visibility", json!({ "active": is_active(&events) })),
          WindowEvent::CloseRequested { api, .. } if cfg!(target_os = "macos") && !desktop.quitting.load(Ordering::Relaxed) => {
            api.prevent_close();
            if let Some(window) = main_window(&events) { let _ = window.hide(); }
            emit(&events, &desktop, "visibility", json!({ "active": false }));
          }
          _ => {}
        }
      });
      render(&handle, &desktop);
      window.show()?;
      window.set_focus()?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("虾扯蛋无法启动")
    .run(|app, event| {
      if let RunEvent::Exit = event {
        if let Some(desktop) = app.try_state::<Arc<Desktop>>() {
          if let Some(mut local) = desktop.local.lock().unwrap().take() { local.stop(); }
        }
      }
    });
}
