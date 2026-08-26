import config from './config.js';
import { getSheetRows, getKnowledgeText } from './data/google.js';

// Pages are rendered from the same cached sheet and doc the agent reads, so the
// site can never disagree with what the bot says on WhatsApp. No build step and
// no second deployment: edit the spreadsheet and both update within the cache
// window.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const inStock = (row) => Number(row['כמות במלאי'] || 0) > 0;
const catUrl = (c) => `/c/${encodeURIComponent(c)}`;

const CAT_ICON = {
  'מזון יבש לכלבים': '🐕',
  'מזון יבש לחתולים': '🐈',
  'מזון רטוב': '🥫',
  'חטיפים': '🦴',
  'חול לחתולים': '🧺',
  'אביזרים לחתולים': '🧶',
  'אביזרים לכלבים': '🎾',
  'טיפוח': '🧴',
  'בריאות': '💊',
  'מכרסמים': '🐹',
  'ציפורים': '🦜',
  'דגים ואקווריום': '🐠',
  'זוחלים': '🦎',
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--g:#15803d;--g2:#166534;--ink:#111827;--mut:#6b7280;--line:#e5e7eb;--bg:#f8fafc}
body{font-family:-apple-system,"Segoe UI",Rubik,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.65}
a{color:inherit;text-decoration:none}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}

nav{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:9}
nav .wrap{display:flex;align-items:center;gap:26px;height:64px}
nav .logo{font-weight:800;font-size:19px;color:var(--g);display:flex;align-items:center;gap:8px}
nav .links{display:flex;gap:20px;font-size:15px;color:var(--mut)}
nav .links a:hover{color:var(--g)}
nav .cta{margin-inline-start:auto;background:var(--g);color:#fff;padding:9px 18px;border-radius:8px;font-weight:600;font-size:14px}

.hero{background:linear-gradient(135deg,#166534,#15803d 55%,#22a04f);color:#fff;padding:64px 0 70px}
.hero h1{font-size:38px;line-height:1.25;font-weight:800;max-width:620px}
.hero p{font-size:17px;opacity:.92;margin-top:14px;max-width:560px}
.hero .btns{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}
.btn{background:#fff;color:var(--g2);padding:12px 24px;border-radius:9px;font-weight:700;font-size:15px;display:inline-block}
.btn.ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.55)}

.props{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:-34px}
.prop{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;box-shadow:0 2px 8px rgba(16,24,40,.05)}
.prop b{display:block;font-size:15px}
.prop span{color:var(--mut);font-size:13.5px}

section{padding:44px 0 0}
.head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}
.head h2{font-size:22px;font-weight:700}
.head a{color:var(--g);font-size:14px;font-weight:600}

.cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.cat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 16px;text-align:center;transition:.15s}
.cat:hover{border-color:var(--g);transform:translateY(-2px);box-shadow:0 6px 16px rgba(16,24,40,.07)}
.cat .ico{font-size:30px}
.cat .nm{font-weight:600;font-size:14.5px;margin-top:6px}
.cat .ct{color:var(--mut);font-size:12.5px}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(224px,1fr));gap:14px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;transition:.15s}
.card:hover{border-color:var(--g);transform:translateY(-2px);box-shadow:0 6px 16px rgba(16,24,40,.07)}
.card .brand{color:var(--mut);font-size:12px;letter-spacing:.02em}
.card .name{font-weight:600;font-size:15px;margin-top:2px}
.card .meta{color:var(--mut);font-size:13px;margin-top:2px}
.card .row{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:12px}
.price{font-weight:800;font-size:17px}
.tag{font-size:11.5px;padding:3px 10px;border-radius:99px;font-weight:700}
.ok{background:#dcfce7;color:#166534}
.no{background:#fee2e2;color:#991b1b}

.crumb{color:var(--mut);font-size:13.5px;padding:22px 0 0}
.crumb a:hover{color:var(--g)}
.detail{display:grid;grid-template-columns:1.05fr .95fr;gap:34px;align-items:start;background:#fff;border:1px solid var(--line);border-radius:14px;padding:30px;margin-top:14px}
.shot{background:linear-gradient(140deg,#ecfdf5,#d1fae5);border:1px solid #bbf7d0;border-radius:12px;aspect-ratio:1/1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.shot .em{font-size:96px;line-height:1}
.shot .lb{color:#166534;font-weight:600;font-size:14px}
@media(max-width:760px){.detail{grid-template-columns:1fr}.shot{aspect-ratio:16/10}}
.detail h1{font-size:27px;line-height:1.3}
.detail .sub{color:var(--mut);margin-top:2px}
.big{font-size:34px;font-weight:800;color:var(--g);margin-top:14px}
table{width:100%;border-collapse:collapse;margin-top:18px}
td{padding:10px 0;border-bottom:1px solid #f1f3f5;font-size:15px}
td:first-child{color:var(--mut);width:140px}
.buy{display:inline-block;margin-top:20px;background:var(--g);color:#fff;padding:13px 26px;border-radius:9px;font-weight:700}

.info{background:#fff;border:1px solid var(--line);border-radius:14px;padding:30px;margin-top:14px;white-space:pre-wrap;font-size:15.5px}

footer{background:#111827;color:#9ca3af;margin-top:60px;padding:40px 0 26px;font-size:14px}
footer .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:26px}
footer b{color:#fff;display:block;margin-bottom:8px;font-size:15px}
footer a:hover{color:#fff}
footer .bot{border-top:1px solid #1f2937;margin-top:26px;padding-top:16px;text-align:center;font-size:13px}
@media(max-width:640px){.hero h1{font-size:28px}nav .links{display:none}}
`;

function shell(title, body, { hero = '' } = {}) {
  const shop = esc(config.business.name);
  const wa = config.shopWhatsapp ? `https://wa.me/${config.shopWhatsapp}` : '#';
  return `<!doctype html><html lang="he" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<nav><div class="wrap">
  <a class="logo" href="/">🐾 ${shop}</a>
  <div class="links"><a href="/">בית</a><a href="/catalog">כל המוצרים</a><a href="/info">מידע ומדיניות</a></div>
  <a class="cta" href="${wa}">כתבו לנו בוואטסאפ</a>
</div></nav>
${hero}
<div class="wrap">${body}</div>
<footer><div class="wrap">
  <div class="cols">
    <div><b>${shop}</b>הכל לחיות המחמד, עם ייעוץ אמיתי ומשלוח מהיר.</div>
    <div><b>קניות</b><a href="/catalog">כל המוצרים</a><br><a href="/info">משלוחים והחזרות</a></div>
    <div><b>צריך עזרה?</b>וואטסאפ זמין כל היום<br>${esc(config.business.ownerPhone || '')}</div>
  </div>
  <div class="bot">© ${new Date().getFullYear()} ${shop}</div>
</div></footer></body></html>`;
}

function card(r) {
  const ok = inStock(r);
  return `<a class="card" href="/p/${esc(r['מקט'])}">
<div class="brand">${esc(r['מותג'] || '')}</div>
<div class="name">${esc(r['שם המוצר'])}</div>
<div class="meta">${esc(r['גודל'])}${r['מתאים ל'] ? ' · ' + esc(r['מתאים ל']) : ''}</div>
<div class="row"><span class="price">${esc(r['מחיר'])} ₪</span>
<span class="tag ${ok ? 'ok' : 'no'}">${ok ? 'במלאי' : 'אזל'}</span></div></a>`;
}

function groupByCategory(rows) {
  const m = new Map();
  for (const r of rows) {
    const c = r['קטגוריה'] || 'שונות';
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(r);
  }
  return m;
}

export async function homePage() {
  const rows = await getSheetRows(config.data.inventorySheetId);
  const cats = groupByCategory(rows);
  const wa = config.shopWhatsapp ? `https://wa.me/${config.shopWhatsapp}` : '/catalog';

  const hero = `<div class="hero"><div class="wrap">
<h1>כל מה שחיית המחמד שלכם צריכה, בלי לצאת מהבית</h1>
<p>מזון, אביזרים וטיפוח מהמותגים המובילים. שואלים אותנו בוואטסאפ ומקבלים תשובה מיד, כולל בדיקת מלאי בזמן אמת.</p>
<div class="btns"><a class="btn" href="${wa}">שאלו אותנו בוואטסאפ</a>
<a class="btn ghost" href="/catalog">לכל המוצרים</a></div>
</div></div>`;

  // One in-stock pick per category keeps the shelf on the home page varied
  // instead of showing eight sizes of the same brand of dog food.
  const featured = [...cats.values()]
    .map((items) => items.find(inStock))
    .filter(Boolean)
    .slice(0, 8);

  const body = `
<div class="props">
  <div class="prop"><b>🚚 משלוח מהיר</b><span>2-4 ימי עסקים, חינם מעל 250 ₪</span></div>
  <div class="prop"><b>💬 מענה בוואטסאפ</b><span>בדיקת מלאי ומחירים תוך שניות</span></div>
  <div class="prop"><b>↩️ החזרה עד 14 יום</b><span>על מוצר סגור באריזה מקורית</span></div>
  <div class="prop"><b>🏠 פנסיון לחיות</b><span>כלבים וחתולים, בסניף רמת גן</span></div>
</div>

<section><div class="head"><h2>קטגוריות</h2><a href="/catalog">כל המוצרים →</a></div>
<div class="cats">${[...cats.entries()]
    .map(
      ([c, items]) => `<a class="cat" href="${catUrl(c)}">
<div class="ico">${CAT_ICON[c] || '🐾'}</div>
<div class="nm">${esc(c)}</div><div class="ct">${items.length} מוצרים</div></a>`
    )
    .join('')}</div></section>

<section><div class="head"><h2>מומלצים השבוע</h2></div>
<div class="grid">${featured.map(card).join('')}</div></section>

<section><div class="head"><h2>לא בטוחים מה מתאים?</h2></div>
<div class="prop" style="padding:26px">
<b style="font-size:17px">תשאלו אותנו בוואטסאפ</b>
<span>ספרו לנו איזו חיה יש לכם ומה אתם מחפשים, ונמליץ על מה שמתאים — כולל בדיקה אם זה במלאי עכשיו.</span>
<div style="margin-top:14px"><a class="buy" style="margin:0" href="${wa}">פתחו שיחה</a></div>
</div></section>`;

  return shell(config.business.name, body, { hero });
}

export async function catalogPage() {
  const rows = await getSheetRows(config.data.inventorySheetId);
  const cats = groupByCategory(rows);
  const body = `<div class="crumb"><a href="/">בית</a> › כל המוצרים</div>
${[...cats.entries()]
    .map(
      ([c, items]) => `<section><div class="head">
<h2>${CAT_ICON[c] || '🐾'} ${esc(c)}</h2><a href="${catUrl(c)}">${items.length} מוצרים →</a></div>
<div class="grid">${items.slice(0, 8).map(card).join('')}</div></section>`
    )
    .join('')}`;
  return shell(`כל המוצרים · ${config.business.name}`, body);
}

export async function categoryPage(name) {
  const rows = await getSheetRows(config.data.inventorySheetId);
  const items = rows.filter((r) => (r['קטגוריה'] || '') === name);
  if (!items.length) return null;
  const body = `<div class="crumb"><a href="/">בית</a> › <a href="/catalog">כל המוצרים</a> › ${esc(name)}</div>
<section style="padding-top:16px"><div class="head">
<h2>${CAT_ICON[name] || '🐾'} ${esc(name)}</h2><span style="color:var(--mut);font-size:14px">${items.length} מוצרים</span></div>
<div class="grid">${items.map(card).join('')}</div></section>`;
  return shell(`${name} · ${config.business.name}`, body);
}

export async function productPage(sku) {
  const rows = await getSheetRows(config.data.inventorySheetId);
  const r = rows.find((x) => String(x['מקט']) === String(sku));
  if (!r) return null;

  const ok = inStock(r);
  const cat = r['קטגוריה'] || '';
  const related = rows.filter((x) => x['קטגוריה'] === cat && x['מקט'] !== r['מקט']).slice(0, 4);
  const wa = config.shopWhatsapp
    ? `https://wa.me/${config.shopWhatsapp}?text=${encodeURIComponent(`היי, מתעניין ב${r['שם המוצר']} ${r['גודל']}`)}`
    : '#';

  const fields = ['מותג', 'קטגוריה', 'מתאים ל', 'גודל', 'מקט']
    .filter((k) => r[k])
    .map((k) => `<tr><td>${esc(k)}</td><td>${esc(r[k])}</td></tr>`)
    .join('');

  const body = `<div class="crumb"><a href="/">בית</a> › <a href="/catalog">כל המוצרים</a> › <a href="${catUrl(cat)}">${esc(cat)}</a></div>
<div class="detail">
<div>
<h1>${esc(r['שם המוצר'])}</h1>
<div class="sub">${esc(r['מותג'] || '')}${r['מתאים ל'] ? ' · ' + esc(r['מתאים ל']) : ''}</div>
<div class="big">${esc(r['מחיר'])} ₪</div>
<p style="margin-top:8px"><span class="tag ${ok ? 'ok' : 'no'}">${ok ? 'במלאי' : 'אזל מהמלאי'}</span></p>
<table>${fields}</table>
<a class="buy" href="${wa}">${ok ? 'להזמנה בוואטסאפ' : 'לשאול מתי חוזר למלאי'}</a>
</div>
<div class="shot"><div class="em">${CAT_ICON[cat] || '🐾'}</div><div class="lb">${esc(r['מותג'] || cat)}</div></div>
</div>
${related.length ? `<section><div class="head"><h2>עוד ב${esc(cat)}</h2><a href="${catUrl(cat)}">הכל →</a></div><div class="grid">${related.map(card).join('')}</div></section>` : ''}`;

  return shell(`${r['שם המוצר']} · ${config.business.name}`, body);
}

export async function infoPage() {
  // Rendered straight from the knowledge doc the agent quotes, so the published
  // policy and the answer a customer gets on WhatsApp are the same text.
  const text = await getKnowledgeText();
  const body = `<div class="crumb"><a href="/">בית</a> › מידע ומדיניות</div>
<div class="info">${esc(text)}</div>`;
  return shell(`מידע ומדיניות · ${config.business.name}`, body);
}
