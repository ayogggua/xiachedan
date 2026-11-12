// macOS 通知改走 UNUserNotificationCenter。tauri-plugin-notification 在 macOS 用的是已废弃的 NSUserNotificationCenter；
// 用过 Electron 版的电脑上，同一 bundle id 已登记为新接口，系统会拒绝新旧接口混用，通知因此全部失效。
use std::sync::OnceLock;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{define_class, AnyThread};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
use objc2_user_notifications::{
  UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationActionOptions,
  UNNotificationCategory, UNNotificationCategoryOptions, UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
  UNNotificationRequest, UNNotificationResponse, UNTextInputNotificationAction, UNTextInputNotificationResponse,
  UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

type Clicked = Box<dyn Fn(Option<i32>) + Send + Sync>;
static CLICKED: OnceLock<Clicked> = OnceLock::new();
// 通知里的「回复」：系统把输入的文字交回来（不唤起窗口），由页面以当前身份发到对应会话。
// 编号为空表示通知来自上一次运行，这一次找不到它属于哪个会话。
type Replied = Box<dyn Fn(Option<i32>, String) + Send + Sync>;
static REPLIED: OnceLock<Replied> = OnceLock::new();
const MESSAGE_CATEGORY: &str = "message";
const REPLY_ACTION: &str = "reply";

fn request_prefix() -> &'static str {
  static PREFIX: OnceLock<String> = OnceLock::new();
  PREFIX.get_or_init(|| format!("{}:", uuid::Uuid::new_v4()))
}

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
      let identifier = response.notification().request().identifier().to_string();
      let id = identifier.strip_prefix(request_prefix()).and_then(|value| value.parse().ok());
      if *response.actionIdentifier() == *unsafe { UNNotificationDefaultActionIdentifier } {
        // 旧进程的通知仍可唤起应用，但不能用重复的编号打开当前进程的其他会话。
        if let Some(clicked) = CLICKED.get() { clicked(id) }
      } else if response.actionIdentifier().to_string() == REPLY_ACTION {
        let text = AsRef::<AnyObject>::as_ref(response).downcast_ref::<UNTextInputNotificationResponse>().map(|reply| reply.userText().to_string());
        if let (Some(text), Some(replied)) = (text, REPLIED.get()) {
          if !text.trim().is_empty() { replied(id, text) }
        }
      }
      completion.call(());
    }
  }
);

/// 在启动阶段（主线程）调用：设置代理、登记点击回调并申请通知权限（已授权的不会再询问）。
/// 一并申请角标权限：没有它，系统会忽略 Dock 图标上的未读数。
pub fn install(clicked: impl Fn(Option<i32>) + Send + Sync + 'static, replied: impl Fn(Option<i32>, String) + Send + Sync + 'static) {
  static DELEGATE: OnceLock<Retained<Delegate>> = OnceLock::new();
  let _ = CLICKED.set(Box::new(clicked));
  let _ = REPLIED.set(Box::new(replied));
  let center = UNUserNotificationCenter::currentNotificationCenter();
  // 不带 Foreground 选项：在通知里回复不会把窗口带到前面。
  let reply = UNTextInputNotificationAction::actionWithIdentifier_title_options_textInputButtonTitle_textInputPlaceholder(
    &NSString::from_str(REPLY_ACTION), &NSString::from_str("回复"), UNNotificationActionOptions::empty(), &NSString::from_str("发送"), &NSString::from_str("回复…"));
  let actions = NSArray::from_retained_slice(&[Retained::into_super(reply)]);
  let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
    &NSString::from_str(MESSAGE_CATEGORY), &actions, &NSArray::new(), UNNotificationCategoryOptions::empty());
  center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
  let delegate = DELEGATE.get_or_init(|| unsafe { objc2::msg_send![super(Delegate::alloc().set_ivars(())), init] });
  center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
  center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Badge, &RcBlock::new(|_: Bool, _: *mut NSError| {}));
}

/// 每次启动使用独立前缀，避免编号重置后覆盖上次运行留下的系统通知。
/// replyable：会话里的消息、内容没有遮挡时才带「回复」输入框。
pub fn show(id: i32, title: &str, body: &str, replyable: bool) {
  let content = UNMutableNotificationContent::new();
  if replyable { content.setCategoryIdentifier(&NSString::from_str(MESSAGE_CATEGORY)); }
  content.setTitle(&NSString::from_str(title));
  content.setBody(&NSString::from_str(body));
  let identifier = NSString::from_str(&format!("{}{id}", request_prefix()));
  let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);
  UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
}
