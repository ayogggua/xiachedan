use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const DEFAULT_PORT: u16 = 4318;
const READY_PREFIX: &str = "虾扯蛋已启动：";

pub struct LocalServer {
  pub address: String,
  pub setup_url: String,
  child: Child,
}

impl LocalServer {
  pub fn stop(&mut self) {
    let _ = self.child.kill();
    let _ = self.child.wait();
  }
}

// 优先沿用 4318，被占用时向系统要一个空闲端口。
fn pick_port() -> std::io::Result<u16> {
  if TcpListener::bind(("0.0.0.0", DEFAULT_PORT)).is_ok() {
    return Ok(DEFAULT_PORT);
  }
  Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

pub fn start(node: &Path, script: &Path, data_dir: &Path) -> Result<LocalServer, String> {
  let port = pick_port().map_err(|error| format!("无法分配本机端口：{error}"))?;
  let mut command = Command::new(node);
  command
    .arg(script)
    .env("PORT", port.to_string())
    .env("CHAT_DATA_DIR", data_dir)
    .env("LINLIAO_EXIT_WITH_STDIN", "1")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::inherit());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  let mut child = command.spawn().map_err(|error| format!("无法启动本机服务：{error}"))?;
  let stdout = child.stdout.take().ok_or("无法读取本机服务输出")?;
  let (ready, wait) = mpsc::channel();
  std::thread::spawn(move || {
    let mut sent = false;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
      if !sent {
        if let Some(url) = line.split_once(READY_PREFIX).map(|(_, url)| url.trim().to_string()) {
          let _ = ready.send(url);
          sent = true;
        }
      }
    }
  });
  match wait.recv_timeout(Duration::from_secs(20)) {
    Ok(setup_url) => Ok(LocalServer { address: format!("http://127.0.0.1:{port}"), setup_url, child }),
    Err(_) => {
      let _ = child.kill();
      Err("本机服务启动超时".into())
    }
  }
}
