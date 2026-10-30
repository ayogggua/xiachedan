use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc;
use std::time::Duration;
use tauri::Url;
use url::Host;

const TIMEOUT: Duration = Duration::from_secs(5);

// 与 shared/invitation.js 的 validateAddress 一致：只接受局域网与本机的 http 根地址。
pub fn private_origin(value: &str) -> Option<String> {
  let url = Url::parse(value).ok()?;
  if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some()
    || url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
    return None;
  }
  let allowed = match url.host()? {
    Host::Ipv4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
    Host::Ipv6(ip) => ip.is_loopback(),
    Host::Domain(name) => name == "localhost",
  };
  allowed.then(|| url.origin().ascii_serialization())
}

pub fn same_origin(left: &str, right: &str) -> bool {
  match (Url::parse(left), Url::parse(right)) {
    (Ok(a), Ok(b)) => a.origin() == b.origin(),
    _ => false,
  }
}

// 直接用 TCP 发一个最小的 HTTP 请求，避免为健康检查引入 HTTP 客户端依赖。
pub fn healthy(origin: &str) -> bool {
  let Ok(url) = Url::parse(origin) else { return false };
  let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else { return false };
  let Some(address) = (host.trim_matches(['[', ']']), port).to_socket_addrs().ok().and_then(|mut list| list.next()) else { return false };
  let Ok(mut stream) = TcpStream::connect_timeout(&address, TIMEOUT) else { return false };
  let _ = stream.set_read_timeout(Some(TIMEOUT));
  let _ = stream.set_write_timeout(Some(TIMEOUT));
  let request = format!("GET /api/health HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
  if stream.write_all(request.as_bytes()).is_err() { return false }
  let mut response = String::new();
  let _ = stream.take(16 * 1024).read_to_string(&mut response);
  response.starts_with("HTTP/1.1 200") && response.contains("\"app\":\"linliao\"")
}

pub fn first_healthy(origins: Vec<String>) -> Option<String> {
  let (found, wait) = mpsc::channel();
  let count = origins.len();
  for origin in origins {
    let found = found.clone();
    std::thread::spawn(move || { let _ = found.send(healthy(&origin).then_some(origin)); });
  }
  for _ in 0..count {
    match wait.recv_timeout(TIMEOUT + Duration::from_secs(1)) {
      Ok(Some(origin)) => return Some(origin),
      Ok(None) => continue,
      Err(_) => break,
    }
  }
  None
}
