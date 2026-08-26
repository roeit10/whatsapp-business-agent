// מפנה את ה-webhook של Green API לכתובת של השירות.
// שימוש:  node scripts/set-webhook.js https://your-app.up.railway.app/webhook
import 'node:process';
import { setWebhook } from '../src/green-api.js';

const url = process.argv[2];
if (!url) {
  console.error('שימוש: node scripts/set-webhook.js <webhook-url>');
  process.exit(1);
}
console.log(await setWebhook(url));
console.log(`ה-webhook הופנה ל-${url}. לוקח ל-Green API עד 90 שניות להחיל את זה.`);
