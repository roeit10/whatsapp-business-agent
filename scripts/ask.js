// בדיקת הסוכן מהטרמינל בלי לשלוח הודעת וואטסאפ.
// שימוש:  node scripts/ask.js "יש לכם רויאל קנין 2 קילו?"  [מספר-טלפון]
import { answer } from '../src/agent.js';

const text = process.argv[2];
const phone = process.argv[3] || '972500000000';
if (!text) {
  console.error('שימוש: node scripts/ask.js "<שאלה>" [מספר-טלפון]');
  process.exit(1);
}
const { reply } = await answer({ text, senderPhone: phone });
console.log(`\n${reply}\n`);
