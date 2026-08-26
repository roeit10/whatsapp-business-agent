/**
 * יצירת קבוצת הוואטסאפ הפנימית שאליה הסוכן מעביר שאלות שאין לו עליהן תשובה.
 *
 * שימוש:  npm run create-group -- 972501234567 [שם הקבוצה]
 *
 * הקבוצה נוצרת על ידי המספר של הסוכן (האינסטנס של Green API), והמספרים
 * שמועברים כאן מתווספים אליה. בסוף מודפס OWNER_GROUP_CHAT_ID שצריך להיכנס ל-.env.
 */
import config from '../src/config.js';
import { createGroup, sendMessage } from '../src/green-api.js';

const args = process.argv.slice(2);
// A phone is anything digit-shaped; everything after it is the group name.
const phones = args.filter((a) => /^\+?\d[\d\s-]{6,}$/.test(a));
const name = args.filter((a) => !phones.includes(a)).join(' ');

if (!phones.length) {
  console.error('חסר מספר טלפון.\nשימוש: npm run create-group -- 972501234567 [שם הקבוצה]');
  console.error('המספר בפורמט בינלאומי בלי + ובלי אפס מוביל: 0501234567 → 972501234567');
  process.exit(1);
}

const groupName = name || `${config.business.name} · שאלות מהסוכן`;

console.log(`יוצר קבוצה "${groupName}" עם: ${phones.join(', ')}`);

const res = await createGroup(groupName, phones);
if (!res.created || !res.chatId) {
  console.error('יצירת הקבוצה נכשלה:', JSON.stringify(res));
  process.exit(1);
}

console.log(`\n✅ הקבוצה נוצרה: ${res.chatId}`);
if (res.groupInviteLink) console.log(`🔗 קישור הצטרפות: ${res.groupInviteLink}`);

await sendMessage(
  res.chatId,
  `👋 זו הקבוצה הפנימית של ${config.business.name}.\n\n` +
    'כששאלה של לקוח לא נמצאת במאגר הידע, הסוכן ישלח אותה לכאן.\n' +
    'עונים כאן בהודעה רגילה — התשובה נשלחת ללקוח ונשמרת במאגר הידע לפעם הבאה.\n' +
    'כשיש כמה שאלות פתוחות, משיבים על הודעת השאלה עצמה או פותחים במספר שלה (#3).'
).catch((err) => console.error('הודעת הפתיחה נכשלה:', err.message));

console.log('\nהוסיפו לקובץ .env (וגם למשתני הסביבה ב-Railway):');
console.log(`OWNER_GROUP_CHAT_ID=${res.chatId}`);
