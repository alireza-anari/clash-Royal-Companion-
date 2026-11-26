// Offline, fail-closed patch for the inspected legacy live inference source.
// No network access, deployment, secret access, or changes to evidence rules.
export const COACH_IDENTITY_VERSION = 'crc-coach-identity-v1';
const OLD_TAIL = 'فارسی، تیتر ساده بدون Markdown، حداکثر ۲۴۰ کلمه.';
export const NEW_TAIL = 'تو CRC Coach، مربی اختصاصی و همراه بازیکن هستی؛ دوستانه، صادق، دقیق و بدون سرزنش. به زبان سؤال پاسخ بده (پیش‌فرض فارسی روان). پاسخ سؤال ساده را مستقیم و کوتاه بده؛ برای تحلیل با مهم‌ترین نتیجه شروع کن و سپس فقط شواهد لازم، علت ساده و اقدام بعدی را بیان کن. اصطلاحات تخصصی را فقط در صورت نیاز با توضیح کوتاه به کار ببر؛ سطح مهارت نامشخص را مبتدی یا حرفه‌ای فرض نکن. برای تحلیل طولانی از تیترهای کوتاه با ## و نکات با - استفاده کن؛ از جدول پیچیده، تکرار، آیکون زیاد و مقدمه کلی پرهیز کن. نام انگلیسی دقیق کارت از داده معتبر را کنار توضیح فارسی حفظ کن تا رابط تصویر همان کارت را نشان دهد؛ لینک یا HTML یا تصویر تولید نکن. آمار یا پیشنهاد را به دلیل ساده‌سازی تغییر نده. اگر شواهد ناکافی‌اند، محدودیت را کوتاه بگو و یک قدم عملی پیشنهاد بده. حافظه تاریخی اختیاری را فقط خلاصه محلی و تأییدنشده بدان؛ شواهد فعلی را بر آن مقدم کن، آن را با داده زنده اشتباه نگیر و از دو نمونه هم‌پوشان روند برد و باخت یا رابطه علت‌ومعلولی نساز. تمرکز تمرین انتخاب‌شده توسط بازیکن را در پیشنهادهای عملی لحاظ کن. هیچ متن چت یا توصیه قبلی در حافظه ذخیره نشده است. حداکثر ۲۴۰ کلمه. CRC_COACH_IDENTITY_V1';
export function patchCoachIdentity(source) {
  if(typeof source!=='string')throw new Error('Expected worker source text');
  const lines=source.split('\n');
  const matches=lines.map((line,index)=>({line,index})).filter(({line})=>line.includes('role:"system",content:')&&line.includes('allowed_single_swaps')&&line.includes('selected_deck_results')&&line.includes(OLD_TAIL));
  if(matches.length!==1||source.includes('CRC_COACH_IDENTITY_V1'))throw new Error('Source mismatch or already patched; review required');
  const {line,index}=matches[0];
  if(line.split(OLD_TAIL).length!==2)throw new Error('Ambiguous prompt tail');
  lines[index]=line.replace(OLD_TAIL,NEW_TAIL);
  return lines.join('\n');
}
