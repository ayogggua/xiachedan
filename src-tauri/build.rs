const COMMANDS: &[&str] = &[
  "desktop_connect", "desktop_home", "desktop_copy", "desktop_ready", "desktop_state", "desktop_settings", "desktop_activity",
  "desktop_message", "desktop_recalled", "desktop_history_cleared", "desktop_test_notification", "desktop_notification_settings", "desktop_appearance", "desktop_drag", "desktop_zoom", "desktop_update_check", "desktop_update_install", "desktop_identity",
];

fn main() {
  println!("cargo:rerun-if-env-changed=LINLIAO_UPDATER_PUBKEY");
  println!("cargo:rerun-if-env-changed=LINLIAO_UPDATE_REPO");
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
    .expect("failed to run tauri-build");
}
