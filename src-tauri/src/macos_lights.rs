// 经典风格把 macOS 红绿灯挪进左侧导航栏。Tauri 2 只能在建窗时定红绿灯位置，tao 每次重绘都按那个位置摆回去；
// 所以这里监听三个按钮的 frame 变化：经典风格下按钮一被系统或 tao 挪动，就立刻摆回导航栏里（同一调用栈内完成，不闪）。
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

use block2::RcBlock;
use objc2::encode::{Encode, Encoding};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::NSString;

/// 与 create_window 里 traffic_light_position 的 x 保持一致。
pub const DEFAULT_X: f64 = 21.0;
/// 经典风格导航栏 76px 宽，三个按钮约 60px，左边留 8px 正好居中。
const CLASSIC_X: f64 = 8.0;

static CLASSIC: AtomicBool = AtomicBool::new(false);
static OBSERVE: Once = Once::new();

#[repr(C)]
#[derive(Clone, Copy)]
struct Point { x: f64, y: f64 }
unsafe impl Encode for Point { const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]); }
#[repr(C)]
#[derive(Clone, Copy)]
struct Size { width: f64, height: f64 }
unsafe impl Encode for Size { const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]); }
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect { origin: Point, size: Size }
unsafe impl Encode for Rect { const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]); }

#[link(name = "AppKit", kind = "framework")]
extern "C" { static NSViewFrameDidChangeNotification: &'static NSString; }

type Buttons = [Retained<AnyObject>; 3];

unsafe fn buttons(ns_window: *mut AnyObject) -> Option<Buttons> {
  let window = ns_window.as_ref()?;
  let button = |kind: usize| -> Option<Retained<AnyObject>> { msg_send![window, standardWindowButton: kind] };
  Some([button(0)?, button(1)?, button(2)?])
}

unsafe fn place(buttons: &Buttons, left: f64, spacing: f64) {
  for (index, button) in buttons.iter().enumerate() {
    let frame: Rect = msg_send![&**button, frame];
    let x = left + index as f64 * spacing;
    // 摆放本身也会触发 frame 通知，位置已对时不再动，避免递归。
    if (frame.origin.x - x).abs() > 0.5 {
      let _: () = msg_send![&**button, setFrameOrigin: Point { x, y: frame.origin.y }];
    }
  }
}

/// 必须在主线程调用。classic 为 true 时把按钮摆进导航栏，否则恢复建窗时的位置。
pub unsafe fn apply(ns_window: *mut std::ffi::c_void, classic: bool) {
  let Some(list) = buttons(ns_window.cast()) else { return };
  let close: Rect = msg_send![&*list[0], frame];
  let minimize: Rect = msg_send![&*list[1], frame];
  let spacing = minimize.origin.x - close.origin.x;
  if spacing <= 0.0 { return; }
  CLASSIC.store(classic, Ordering::Relaxed);
  // 一直用虾扯蛋风格时完全不插手，交给 tao。
  if !classic && !OBSERVE.is_completed() { return; }
  OBSERVE.call_once(|| {
    let center: Retained<AnyObject> = msg_send![class!(NSNotificationCenter), defaultCenter];
    for index in 0..3 {
      let Some(watched) = buttons(ns_window.cast()) else { return };
      let target = watched[index].clone();
      let _: () = msg_send![&*target, setPostsFrameChangedNotifications: true];
      let block = RcBlock::new(move |_note: NonNull<AnyObject>| {
        if CLASSIC.load(Ordering::Relaxed) { place(&watched, CLASSIC_X, spacing); }
      });
      let observer: Option<Retained<AnyObject>> = msg_send![&*center, addObserverForName: NSViewFrameDidChangeNotification, object: &*target, queue: None::<&AnyObject>, usingBlock: &*block];
      // 观察者随窗口存续到程序退出，不需要注销。
      std::mem::forget(observer);
    }
  });
  place(&list, if classic { CLASSIC_X } else { DEFAULT_X }, spacing);
}
