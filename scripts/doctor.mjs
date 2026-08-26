/**
 * בדיקת מוכנות — מה כבר מחובר ומה חסר.
 * שימוש:  npm run doctor
 *
 * מיועד להיקרא גם על ידי Claude Code בתחילת האונבורדינג. הפלט מסתיים
 * בשורת NEXT שאומרת באיזה שלב ב-ONBOARDING.md להתחיל, כדי שההחלטה
 * תתבסס על בדיקה בפועל ולא על ניחוש.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const ok = (s) => `✅ ${s}`;
const no = (s) => `❌ ${s}`;
const warn = (s) => `⚠️  ${s}`;

function sh(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() };
  } catch (err) {
    return { ok: false, out: (err.stdout?.toString() || err.stderr?.toString() || '').trim() };
  }
}

/** .env is read by hand so the doctor runs even when the file is malformed. */
function readEnv() {
  if (!fs.existsSync('.env')) return null;
  const env = {};
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const missing = [];
const TEMPLATE_REPO = 'roeit10/whatsapp-business-agent';

// ---------- 0. ריפו משלכם ----------
console.log('\n\x1b[1m0. הריפו\x1b[0m');
const origin = sh('git remote get-url origin');
if (!origin.ok) {
  console.log(no('אין ריפו git — צריך ריפו משלכם שנוצר מהתבנית'));
  missing.push('own-repo');
} else if (origin.out.includes(TEMPLATE_REPO)) {
  // Working directly inside the shared template is the most common first
  // mistake: Railway cannot deploy from a repo the student does not own, and
  // any commit here would try to push to the course material.
  console.log(no(`עובדים בתוך התבנית עצמה (${TEMPLATE_REPO}) — צריך ריפו משלכם`));
  missing.push('own-repo');
} else {
  console.log(ok(`ריפו משלכם — ${origin.out.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}`));
}

// ---------- 1. סביבת הרצה ----------
console.log('\n\x1b[1m1. סביבת הרצה\x1b[0m');
const major = Number(process.version.slice(1).split('.')[0]);
if (major >= 20) console.log(ok(`Node ${process.version}`));
else {
  console.log(no(`Node ${process.version} — נדרש 20 ומעלה`));
  missing.push('node');
}

// ---------- 2. כלי שורת פקודה ----------
console.log('\n\x1b[1m2. כלי שורת פקודה\x1b[0m');
for (const [name, bin, authCmd, authHint] of [
  ['Railway', 'railway', 'railway whoami', 'railway login'],
  ['GitHub', 'gh', 'gh auth status', 'gh auth login'],
]) {
  const installed = sh(`command -v ${bin}`).ok;
  if (!installed) {
    console.log(no(`${name} CLI לא מותקן`));
    missing.push(`${bin}-install`);
    continue;
  }
  const auth = sh(authCmd);
  if (auth.ok) {
    const who = auth.out.split('\n').find((l) => l.trim()) || '';
    console.log(ok(`${name} CLI — ${who.replace(/\s+/g, ' ').slice(0, 60)}`));
  } else {
    console.log(no(`${name} CLI מותקן אבל לא מחובר — צריך: ${authHint}`));
    missing.push(`${bin}-login`);
  }
}

// ---------- 3. קובץ ההגדרות ----------
console.log('\n\x1b[1m3. קובץ ההגדרות (.env)\x1b[0m');
const env = readEnv();
if (!env) {
  console.log(no('.env לא קיים — יש להעתיק מ-.env.example'));
  missing.push('env-file');
} else {
  const required = {
    GREEN_API_ID_INSTANCE: 'Green API',
    GREEN_API_TOKEN: 'Green API',
    OPENROUTER_API_KEY: 'OpenRouter',
    KNOWLEDGE_DOC_ID: 'מסמך הידע',
    INVENTORY_SHEET_ID: 'גיליון המלאי',
    ORDERS_SHEET_ID: 'גיליון ההזמנות',
  };
  for (const [key, label] of Object.entries(required)) {
    if (env[key]) console.log(ok(`${key} (${label})`));
    else {
      console.log(no(`${key} חסר (${label})`));
      missing.push(key);
    }
  }
  // Optional on purpose: without it the agent refers the customer to the owner's
  // phone instead of asking in the group, which is a working setup — so it must
  // not hold back NEXT: READY.
  if (env.OWNER_GROUP_CHAT_ID) console.log(ok(`OWNER_GROUP_CHAT_ID (קבוצת השאלות)`));
  else console.log(warn('OWNER_GROUP_CHAT_ID חסר — הסוכן לא יעביר שאלות לבעל העסק. ליצירה: npm run create-group -- <טלפון>'));
}

// ---------- 4. בדיקות חיות ----------
console.log('\n\x1b[1m4. בדיקה מול השירותים\x1b[0m');

if (env?.GREEN_API_ID_INSTANCE && env?.GREEN_API_TOKEN) {
  const shard = String(env.GREEN_API_ID_INSTANCE).slice(0, 4);
  try {
    const r = await fetch(
      `https://${shard}.api.greenapi.com/waInstance${env.GREEN_API_ID_INSTANCE}/getStateInstance/${env.GREEN_API_TOKEN}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (r.status === 401) {
      console.log(no('Green API — הטוקן לא תקין'));
      missing.push('greenapi-token');
    } else {
      const { stateInstance } = await r.json();
      if (stateInstance === 'authorized') console.log(ok('Green API — מחובר לוואטסאפ'));
      else {
        // `starting` is a transient boot state, not a broken instance.
        console.log(warn(`Green API — מצב "${stateInstance}". אם זה נמשך, לסרוק QR או ללחוץ אתחול בקונסולה`));
        missing.push('greenapi-scan');
      }
    }
  } catch {
    console.log(no('Green API — לא הצלחתי להגיע לשירות'));
    missing.push('greenapi-reach');
  }
} else console.log('⏭️  Green API — מדלג, אין מפתחות');

if (env?.OPENROUTER_API_KEY) {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
      const d = await r.json();
      const left = d?.data?.limit_remaining;
      console.log(ok(`OpenRouter — המפתח תקין${left != null ? ` · נותרו $${left}` : ''}`));
    } else {
      console.log(no(`OpenRouter — המפתח נדחה (${r.status})`));
      missing.push('openrouter-key');
    }
  } catch {
    console.log(no('OpenRouter — לא הצלחתי להגיע לשירות'));
    missing.push('openrouter-reach');
  }
} else console.log('⏭️  OpenRouter — מדלג, אין מפתח');

const googleFiles = [
  ['KNOWLEDGE_DOC_ID', 'מסמך הידע', (id) => `https://docs.google.com/document/d/${id}/export?format=txt`],
  ['INVENTORY_SHEET_ID', 'גיליון המלאי', (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`],
  ['ORDERS_SHEET_ID', 'גיליון ההזמנות', (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`],
];
for (const [key, label, url] of googleFiles) {
  if (!env?.[key]) {
    console.log(`⏭️  ${label} — מדלג, אין מזהה`);
    continue;
  }
  try {
    const r = await fetch(url(env[key]), { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const body = r.ok ? await r.text() : '';
    // A file that is not link-shared redirects to a Google sign-in page, which
    // still returns 200 — so check the body, not just the status.
    if (r.ok && !/<html/i.test(body.slice(0, 200))) console.log(ok(`${label} — קריא`));
    else {
      console.log(no(`${label} — לא קריא. צריך לשתף ב"כל מי שיש לו את הקישור — צפייה"`));
      missing.push(`${key}-share`);
    }
  } catch {
    console.log(no(`${label} — לא הצלחתי להגיע`));
    missing.push(`${key}-reach`);
  }
}

// ---------- סיכום ----------
console.log('\n' + '─'.repeat(58));
if (!missing.length) {
  console.log('\x1b[32m\x1b[1mהכל מחובר. אפשר להתחיל.\x1b[0m');
  console.log('NEXT: READY');
  process.exit(0);
}

// Installs come before STEP 0 even though STEP 0 is numbered first: creating the
// repo from the template needs `gh`, so pointing at STEP 0 while gh is missing
// sends the agent to a command that cannot run.
const step =
  missing.some((m) => m.endsWith('-install')) ? 'STEP 1'
  : missing.some((m) => m.endsWith('-login')) ? 'STEP 2'
  : missing.includes('own-repo') ? 'STEP 0'
  : missing.some((m) => m.startsWith('GREEN_API') || m.startsWith('greenapi')) ? 'STEP 3'
  : missing.some((m) => m.startsWith('OPENROUTER') || m.startsWith('openrouter')) ? 'STEP 4'
  : 'STEP 5';

console.log(`\x1b[33mחסרים ${missing.length} דברים:\x1b[0m ${missing.join(', ')}`);
console.log(`NEXT: ${step}  (ראו ONBOARDING.md)`);
process.exit(1);
