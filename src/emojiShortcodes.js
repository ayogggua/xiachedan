// 表情短码：输入「:名字」弹出候选，输入完整的「:名字:」直接换成表情。英文名沿用 GitHub / Slack 的常见写法，另加几个拼音。
const LIST = `
smile 😄|grin 😁|joy 😂|rofl 🤣|laughing 😆|sweat_smile 😅|blush 😊|innocent 😇|slightly_smiling_face 🙂|upside_down 🙃|wink 😉|relieved 😌
heart_eyes 😍|kissing_heart 😘|yum 😋|stuck_out_tongue 😛|zany 🤪|sunglasses 😎|nerd 🤓|thinking 🤔|neutral_face 😐|expressionless 😑|no_mouth 😶
roll_eyes 🙄|smirk 😏|grimacing 😬|zipper_mouth 🤐|sleeping 😴|sleepy 😪|open_mouth 😮|astonished 😲|yawning 🥱|cry 😢|sob 😭|triumph 😤
angry 😠|rage 😡|exploding_head 🤯|flushed 😳|hot 🥵|cold 🥶|scream 😱|fearful 😨|sweat 😓|hugs 🤗|hand_over_mouth 🤭|salute 🫡|shush 🤫
mask 😷|partying 🥳|pleading 🥺|melting 🫠|skull 💀|ghost 👻|robot 🤖|poop 💩|clown 🤡|see_no_evil 🙈|shrug 🤷|facepalm 🤦
+1 👍|thumbsup 👍|-1 👎|thumbsdown 👎|ok_hand 👌|v ✌️|crossed_fingers 🤞|call_me 🤙|point_left 👈|point_right 👉|point_up 👆|point_down 👇
raised_hand ✋|wave 👋|handshake 🤝|pray 🙏|clap 👏|raised_hands 🙌|muscle 💪|writing_hand ✍️|heart_hands 🫶|eyes 👀|brain 🧠
heart ❤️|orange_heart 🧡|yellow_heart 💛|green_heart 💚|blue_heart 💙|purple_heart 💜|black_heart 🖤|broken_heart 💔|two_hearts 💕
100 💯|anger 💢|boom 💥|dizzy 💫|sweat_drops 💦|zzz 💤|fire 🔥|sparkles ✨|tada 🎉|confetti_ball 🎊|balloon 🎈|gift 🎁|trophy 🏆
medal 🥇|star ⭐|star2 🌟|sunny ☀️|rainbow 🌈|umbrella ☔|snowflake ❄️|zap ⚡|coffee ☕|tea 🍵|bubble_tea 🧋|beer 🍺|beers 🍻
cake 🍰|birthday 🎂|watermelon 🍉|apple 🍎|ramen 🍜|rice 🍚|hamburger 🍔|pizza 🍕|fries 🍟|dumpling 🥟|bento 🍱|car 🚗|taxi 🚕
metro 🚇|airplane ✈️|house 🏠|office 🏢|computer 💻|keyboard ⌨️|phone 📱|camera 📷|calendar 📅|pushpin 📌|paperclip 📎|memo 📝
books 📚|bulb 💡|bell 🔔|mag 🔍|lock 🔒|key 🔑|alarm_clock ⏰|hourglass ⏳|moneybag 💰|chart_up 📈|chart_down 📉|white_check_mark ✅
check ✅|x ❌|warning ⚠️|question ❓|exclamation ❗|ok 🆗|new 🆕|rocket 🚀|bug 🐛|wrench 🔧|hammer 🔨|gear ⚙️|link 🔗|email 📧
cat 🐱|dog 🐶|shrimp 🦐|crown 👑|dianzan 👍|zan 👍|xiaoku 😂|ku 😭|hao 👌|baoquan 🙏|aixin ❤️|huo 🔥|qingzhu 🎉|dengpao 💡|kafei ☕|jiayou 💪`;

export const SHORTCODES = LIST.trim().split(/[|\n]/).map(item => item.trim().split(' ')).filter(pair => pair.length === 2);
const BY_NAME = new Map(SHORTCODES);
export const emojiFor = name => BY_NAME.get(name.toLowerCase());
// 候选：名字以输入开头的排在前面，其次是包含输入的；同一个表情只出现一次。
export function matchShortcodes(query, limit = 8) {
  const needle = query.toLowerCase(), seen = new Set(), result = [];
  for (const pass of [name => name.startsWith(needle), name => name.includes(needle)]) for (const [name, emoji] of SHORTCODES) {
    if (result.length >= limit) return result;
    if (!seen.has(emoji) && pass(name)) { seen.add(emoji); result.push({ name, emoji }); }
  }
  return result;
}
