use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Webview};

use crate::{emit, main_window, require_trusted, valid_id, Desktop, Shared};

pub struct NativeContextMenu {
  // Linux 的弹出菜单异步关闭，保留菜单直到下次右键，避免提前释放。
  _menu: Menu<tauri::Wry>,
  request_id: String,
  origin: String,
  actions: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuOptions {
  kind: String,
  #[serde(default)]
  pinned: bool,
  #[serde(default)]
  muted: bool,
  #[serde(default)]
  unread: bool,
  #[serde(default)]
  can_reply: bool,
  #[serde(default)]
  can_react: bool,
  #[serde(default)]
  can_thread: bool,
  #[serde(default)]
  can_forward: bool,
  #[serde(default)]
  can_copy: bool,
  #[serde(default)]
  can_edit: bool,
  #[serde(default)]
  can_pin: bool,
  #[serde(default)]
  can_save: bool,
  #[serde(default)]
  saved: bool,
  #[serde(default)]
  can_remind: bool,
  #[serde(default)]
  can_recall: bool,
  #[serde(default)]
  can_remove: bool,
}

#[tauri::command]
pub async fn desktop_context_menu(app: AppHandle, webview: Webview, desktop: Shared<'_>, request_id: String, value: ContextMenuOptions) -> Result<(), String> {
  require_trusted(&webview, &desktop)?;
  if !valid_id(&request_id) { return Err("菜单请求无效".into()); }
  let origin = desktop.session.lock().unwrap().active_origin.clone();
  let menu = Menu::new(&app).map_err(|error| error.to_string())?;
  let mut actions = HashMap::new();
  let mut add = |action: &str, label: &str| -> tauri::Result<()> {
    let id = format!("context-{}-{action}", uuid::Uuid::new_v4());
    menu.append(&MenuItem::with_id(&app, &id, label, true, None::<&str>)?)?;
    actions.insert(id, action.to_string());
    Ok(())
  };
  let mut build = || -> tauri::Result<()> {
    match value.kind.as_str() {
      "conversation" => {
        add(if value.unread { "read" } else { "unread" }, if value.unread { "标为已读" } else { "标为未读" })?;
        add(if value.pinned { "unpin" } else { "pin" }, if value.pinned { "取消置顶" } else { "置顶对话" })?;
        add(if value.muted { "unmute" } else { "mute" }, if value.muted { "取消免打扰" } else { "消息免打扰" })?;
        add("export", "导出聊天记录")?;
        menu.append(&PredefinedMenuItem::separator(&app)?)?;
        add("remove", "移除对话")?;
      }
      "message" => {
        // 分组之间用分隔线隔开，空的分组不占位置。
        let groups: [&[(bool, &str, &str)]; 3] = [
          &[(value.can_reply, "reply", "回复"), (value.can_thread, "thread", "在话题中回复"), (value.can_react, "react", "回应"), (value.can_forward, "forward", "转发"), (value.can_forward, "select", "多选")],
          &[(value.can_copy, "copy", "复制"), (value.can_edit, "edit", "编辑"), (value.can_remind, "remind", "提醒我…"), (value.can_save && !value.saved, "save", "收藏"), (value.can_save && value.saved, "unsave", "取消收藏"), (value.can_pin && !value.pinned, "pin", "置顶消息"), (value.can_pin && value.pinned, "unpin", "取消置顶消息")],
          &[(value.can_recall, "recall", "撤回消息"), (value.can_remove, "remove", "删除消息（管理员）")],
        ];
        let mut first = true;
        for group in groups {
          let items: Vec<_> = group.iter().filter(|item| item.0).collect();
          if items.is_empty() { continue; }
          if !first { menu.append(&PredefinedMenuItem::separator(&app)?)?; }
          first = false;
          for (_, action, label) in items { add(action, label)?; }
        }
      }
      "edit" => {
        menu.append_items(&[
          &PredefinedMenuItem::undo(&app, Some("撤销"))?,
          &PredefinedMenuItem::redo(&app, Some("重做"))?,
          &PredefinedMenuItem::separator(&app)?,
          &PredefinedMenuItem::cut(&app, Some("剪切"))?,
          &PredefinedMenuItem::copy(&app, Some("复制"))?,
          &PredefinedMenuItem::paste(&app, Some("粘贴"))?,
          &PredefinedMenuItem::separator(&app)?,
          &PredefinedMenuItem::select_all(&app, Some("全选"))?,
        ])?;
      }
      "selection" => { menu.append(&PredefinedMenuItem::copy(&app, Some("复制"))?)?; }
      _ => {}
    }
    Ok(())
  };
  build().map_err(|error| error.to_string())?;
  if menu.items().map_err(|error| error.to_string())?.is_empty() { return Ok(()); }
  let window = main_window(&app).ok_or("窗口不可用")?;
  let previous = desktop.context_menu.lock().unwrap().replace(NativeContextMenu { _menu: menu.clone(), request_id, origin, actions });
  drop(previous);
  window.popup_menu(&menu).map_err(|error| error.to_string())
}

pub fn handle_action(app: &AppHandle, desktop: &Desktop, id: &str) {
  let origin = desktop.session.lock().unwrap().active_origin.clone();
  let event = {
    let mut current = desktop.context_menu.lock().unwrap();
    let Some(context) = current.as_mut().filter(|context| context.origin == origin) else { return };
    let Some(action) = context.actions.remove(id) else { return };
    context.actions.clear();
    json!({ "requestId": context.request_id, "action": action })
  };
  emit(app, desktop, "context-menu-action", event);
}
