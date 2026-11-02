// macOS 通知改走 UNUserNotificationCenter。tauri-plugin-notification 在 macOS 用的是已废弃的 NSUserNotificationCenter；
// 用过 Electron 版的电脑上，同一 bundle id 已登记为新接口，系统会拒绝新旧接口混用，通知因此全部失效。
use std::sync::OnceLock;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, AnyThread};
use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
  UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationDefaultActionIdentifier,
  UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
  UNUserNotificationCenterDelegate,
};

type Clicked = Box<dyn Fn(i32) + Send + Sync>;
static CLICKED: OnceLock<Clicked> = OnceLock::new();

define_class!(
  #[unsafe(super(NSObject))]
  #[name = "LinliaoNotificationDelegate"]
  struct Delegate;

  unsafe impl NSObjectProtocol for Delegate {}

  unsafe impl UNUserNotificationCenterDelegate for Delegate {
    // 应用在前台时系统默认不显示通知；在别的会话收到消息也要提醒。
    #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
    fn will_present(&self, _center: &UNUserNotificationCenter, _notification: &UNNotification,
      completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
      completion.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,));
    }

    #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
    fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse,
      completion: &block2::DynBlock<dyn Fn()>) {
      if *response.actionIdentifier() == *unsafe { UNNotificationDefaultActionIdentifier } {
        let id = response.notification().request().identifier().to_string().parse().ok();
        if let (Some(id), Some(clicked)) = (id, CLICKED.get()) { clicked(id) }
      }
      completion.call(());
    }
  }
);

/// 在启动阶段（主线程）调用：设置代理、登记点击回调并申请通知权限（已授权的不会再询问）。
pub fn install(clicked: impl Fn(i32) + Send + Sync + 'static) {
  static DELEGATE: OnceLock<Retained<Delegate>> = OnceLock::new();
  let _ = CLICKED.set(Box::new(clicked));
  let center = UNUserNotificationCenter::currentNotificationCenter();
  let delegate = DELEGATE.get_or_init(|| unsafe { objc2::msg_send![super(Delegate::alloc().set_ivars(())), init] });
  center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
  center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert, &RcBlock::new(|_: Bool, _: *mut NSError| {}));
}

/// 以 id 作为请求标识发出通知，点击时回调收到同一个 id。
pub fn show(id: i32, title: &str, body: &str) {
  let content = UNMutableNotificationContent::new();
  content.setTitle(&NSString::from_str(title));
  content.setBody(&NSString::from_str(body));
  let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&id.to_string()), &content, None);
  UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
}
