import config from './config.js';
import { getKnowledgeText, getSheetRows } from './data/google.js';
import { knowledgeAddendum } from './knowledge.js';
import * as tickets from './tickets.js';
import { sendMessage } from './green-api.js';
import { norm, similarity } from './text.js';

/**
 * Tool schemas handed to the model. Descriptions are prescriptive about *when*
 * to call each one — that is what drives the model to actually use them instead
 * of answering from its own guesses.
 */
export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'get_shop_info',
      description:
        'מחזיר את מאגר הידע של העסק: שעות פתיחה, מדיניות משלוחים, מדיניות החזרות, מחירי פנסיון, אמצעי תשלום. ' +
        'יש לקרוא לכלי הזה לכל שאלה על נהלים, שעות, מחירי שירות או מדיניות. אין לענות על שאלות כאלה מהזיכרון.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_inventory',
      description:
        'בודק זמינות ומחיר של מוצר במלאי החנות. יש לקרוא לכלי הזה לכל שאלה בנוסח "יש לכם X", "כמה עולה X", ' +
        '"יש במלאי X". חיפוש חופשי לפי שם מוצר או קטגוריה. אין להמציא מחירים או כמויות.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'שם המוצר או הקטגוריה לחיפוש, לדוגמה "רויאל קנין" או "חול לחתולים"',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description:
        'מחזיר את כל היסטוריית ההזמנות של הלקוח ששלח את ההודעה, מהחדשה לישנה, ' +
        'כולל תאריך הזמנה, פריטים, סטטוס ותאריך משלוח צפוי. ' +
        'קרא לכלי הזה גם לשאלות על משלוח ("איפה ההזמנה שלי", "מתי מגיע"), וגם כשאתה רוצה להבין ' +
        'מה הלקוח נוהג לקנות כדי להמליץ לו או להזכיר לו לחדש מלאי. ' +
        'הזיהוי אוטומטי לפי מספר הוואטסאפ של השולח. העבר order_number רק אם הלקוח ציין מספר במפורש.',
      parameters: {
        type: 'object',
        properties: {
          order_number: {
            type: 'string',
            description: 'מספר הזמנה, רק אם הלקוח ציין אותו במפורש בהודעה',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_owner',
      description:
        'מעביר שאלה של הלקוח לבעל העסק בקבוצת הוואטסאפ הפנימית, וכשהוא עונה התשובה נשלחת ללקוח אוטומטית ונשמרת במאגר הידע. ' +
        'קרא לכלי הזה רק אחרי שכבר בדקת ב-get_shop_info ו/או ב-check_inventory ולא מצאת את התשובה, ' +
        'ורק כשמדובר בשאלה עובדתית על העסק שרק בעל העסק יכול לענות עליה — נוהל, מדיניות, מחיר שירות, ' +
        'זמינות של משהו שלא מופיע בקטלוג, אפשרות להזמנה מיוחדת. ' +
        'אל תקרא לו כשהתשובה כבר בכלים, כשהמוצר פשוט אזל מהמלאי, לשאלה וטרינרית, או כשהלקוח מבקש לדבר עם בן אדם — שם פשוט מוסרים את הטלפון.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'השאלה לבעל העסק, מנוסחת כשאלה עצמאית שמובנת בלי השיחה. לדוגמה: "האם אנחנו מוכרים כלובים לארנבים?" ולא "והשאלה שלו?"',
          },
        },
        required: ['question'],
      },
    },
  },
];

/** ISO date for today, so date arithmetic never depends on the model guessing. */
const today = () => new Date().toISOString().slice(0, 10);

const FUZZY_THRESHOLD = 0.58;
// Short words are too easy to mutate into each other ("חול" vs "חתול" scores
// 0.75), so fuzzy matching only applies from four characters up.
const FUZZY_MIN_LENGTH = 4;

// Words that carry no signal in a product query and would otherwise inflate the
// score of unrelated rows.
const STOPWORDS = new Set([
  'יש','לכם','לך','אני','צריך','צריכה','רוצה','מחפש','מחפשת','את','של','עם',
  'כמה','עולה','במלאי','בבקשה','היי','שלום','אפשר','לקנות','מה','המחיר','זה',
]);

/**
 * What the model is allowed to see about a product.
 * The raw stock count never leaves this function: the shop does not want
 * "we have 14 left" quoted at customers, and an instruction not to say it is
 * weaker than simply not providing it. Same principle as closing over the
 * sender's phone below.
 */
const isAvailable = (row) => Number(row['כמות במלאי'] || 0) > 0;

function publicProduct(row) {
  const { 'כמות במלאי': qty, ...rest } = row;
  return {
    ...rest,
    זמינות: Number(qty || 0) > 0 ? 'במלאי' : 'אזל מהמלאי',
    ...(config.siteBaseUrl && row['מקט']
      ? { 'קישור לעמוד המוצר': `${config.siteBaseUrl}/p/${row['מקט']}` }
      : {}),
  };
}

/** Strip everything but digits so 050-123-4567 and 972501234567 compare equal. */
const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * The sender's phone is closed over here rather than passed as a tool argument.
 * A model that could pass an arbitrary phone number could be talked into reading
 * someone else's order ("check the order for 05X-XXXXXXX") — closing over the
 * value taken from the webhook makes that impossible.
 */
export function buildExecutors({ senderPhone, chatId, customerName, customerText }) {
  return {
    async get_shop_info() {
      // The doc first, then anything the owner answered in the group since.
      // Later answers win by being later in the text, which is also how a human
      // reads a document with a correction appended at the bottom.
      return (await getKnowledgeText()) + knowledgeAddendum();
    },

    async check_inventory({ query }) {
      const rows = await getSheetRows(config.data.inventorySheetId);
      const terms = norm(query)
        .split(' ')
        .filter((t) => t && !STOPWORDS.has(t));

      // Rank by how many query terms a row matches rather than requiring all of
      // them. Requiring all means one stray word ("קילו" against a "קג" sheet)
      // turns a product that is clearly in stock into "not found".
      // A term counts if it appears literally, or if it is close enough to one
      // of the row's words to be an obvious misspelling of it.
      const score = (r) => {
        const hay = norm(Object.values(r).join(' '));
        const words = hay.split(' ').filter(Boolean);
        return terms.filter(
          (t) =>
            hay.includes(t) ||
            (t.length >= FUZZY_MIN_LENGTH &&
              words.some((w) => similarity(t, w) >= FUZZY_THRESHOLD))
        ).length;
      };

      const scored = rows
        .map((r) => ({ row: r, score: score(r) }))
        .filter((x) => x.score > 0)
        // Within the same relevance, an item on the shelf beats one that is out.
        // Ranking on text alone once sent a customer a link to a product that
        // had already sold out, while an equivalent in-stock size sat unshown.
        .sort(
          (a, b) =>
            b.score - a.score || Number(isAvailable(b.row)) - Number(isAvailable(a.row))
        );

      const best = scored.length ? scored[0].score : 0;
      const tied = scored.filter((x) => x.score === best);
      const matches = tied.slice(0, 12).map((x) => publicProduct(x.row));

      if (!matches.length) {
        // Nothing matched even loosely. Rather than declaring "we don't carry
        // it" on the strength of a string comparison, hand the whole catalogue
        // to the model — it understands that "אוכל לתוכי" and "מזון לציפורים"
        // are the same thing, and that a mangled brand name is still that brand.
        return (
          `לא נמצאה התאמה טקסטואלית ל"${query}". להלן קטלוג המלאי המלא.\n` +
          'לקוחות מקלידים שמות מותגים בשגיאה כל הזמן, ובעברית זה קורה יותר. ' +
          'עבור על הקטלוג ושאל את עצמך למה הלקוח סביר שהתכוון — לא רק מה זהה לו.\n' +
          '- אם סביר שזו שגיאת כתיב או ניסוח אחר של מוצר מהרשימה, ענה לפיו.\n' +
          '- אם אתה מהסס בין אפשרות אחת או שתיים, אל תגיד שאין. שאל את הלקוח ' +
          'אם לזה הוא התכוון, בדיוק כמו מוכר בחנות.\n' +
          '- רק אם באמת אין בקטלוג שום דבר קרוב, אמור שהמוצר לא מופיע אצלנו.\n' +
          JSON.stringify(rows.map(publicProduct), null, 1)
        );
      }
      // Tell the model how wide the result set is. With a 150-product catalogue a
      // broad request like "food for my dog" matches dozens of rows, and dumping
      // them all at the customer is worse than asking one narrowing question.
      const head =
        tied.length > 4
          ? `נמצאו ${tied.length} מוצרים שמתאימים לבקשה (מוצגים ${matches.length}). ` +
            'זה רחב מדי בשביל תשובה אחת — שאל את הלקוח שאלת סינון אחת (גזע, גיל, גודל אריזה) ' +
            'ורק אז המלץ.\n'
          : '';

      // If everything that matched is out of stock, never hand back a dead end.
      // Surface in-stock items from the same categories so the answer can be
      // "that one is out, but here is what I do have".
      let tail = '';
      if (!tied.some((x) => isAvailable(x.row))) {
        const cats = new Set(tied.map((x) => x.row['קטגוריה']));
        // Rank alternatives by who the product is FOR, not by how well they match
        // the words the customer typed. Ranking on the query text put five adult
        // cat foods in front of someone asking for kitten food, purely because
        // they shared a brand name — the one thing that does not matter here.
        const wantedFor = norm(tied[0].row['מתאים ל'] || '');
        const fit = (r) => (wantedFor ? similarity(wantedFor, norm(r['מתאים ל'] || '')) : 0);

        const alternatives = rows
          .filter((r) => cats.has(r['קטגוריה']) && isAvailable(r))
          .map((r) => ({ row: r, fit: fit(r), score: score(r) }))
          .sort((a, b) => b.fit - a.fit || b.score - a.score)
          .slice(0, 5)
          .map((x) => publicProduct(x.row));

        tail = alternatives.length
          ? '\n\nכל מה שתאם לבקשה אזל מהמלאי. אלה חלופות זמינות מאותה קטגוריה — ' +
            'אמור ללקוח שהמוצר שביקש אזל, והצע לו אחת מהן במשפט אחד:\n' +
            JSON.stringify(alternatives, null, 1)
          : '\n\nכל מה שתאם לבקשה אזל, ואין כרגע שום חלופה זמינה באותה קטגוריה. ' +
            'אמור את זה בכנות, אל תשלח קישור למוצר שאזל כאילו הוא פתרון, ' +
            'והצע ללקוח לעדכן אותו כשהמוצר חוזר למלאי.';
      }

      return head + JSON.stringify(matches, null, 1) + tail;
    },

    async lookup_order({ order_number } = {}) {
      const rows = await getSheetRows(config.data.ordersSheetId);
      const phoneKey = digits(senderPhone);

      const byPhone = rows
        .filter((r) => digits(r['טלפון']) === phoneKey)
        .sort((a, b) => String(b['תאריך הזמנה']).localeCompare(String(a['תאריך הזמנה'])));
      if (byPhone.length) {
        return (
          `היסטוריית ההזמנות של הלקוח, מהחדשה לישנה. היום ${today()}.\n` +
          JSON.stringify(byPhone, null, 1)
        );
      }

      if (order_number) {
        const byNumber = rows.filter(
          (r) => norm(r['מספר הזמנה']) === norm(order_number)
        );
        if (byNumber.length) return JSON.stringify(byNumber, null, 1);
        return `לא נמצאה הזמנה עם מספר ${order_number}.`;
      }

      return (
        'לא נמצאה הזמנה שמשויכת למספר הטלפון שממנו נשלחה ההודעה. ' +
        'יש לבקש מהלקוח מספר הזמנה, או להפנות אותו לבעל העסק.'
      );
    },

    async ask_owner({ question }) {
      const { ownerName, ownerPhone } = config.business;
      const q = String(question || '').trim();
      if (!q) return 'לא הועברה שאלה. נסח את השאלה לבעל העסק במלואה.';

      // No group configured is not an error — it is the pre-setup state. Fall
      // back to what the agent did before this feature existed rather than
      // telling a live customer that something is broken.
      if (!config.ownerGroupChatId) {
        return (
          `לא ניתן להעביר את השאלה לבעל העסק כרגע. אמור ללקוח שאין לך את המידע, ` +
          `והפנה אותו ל${ownerName}${ownerPhone ? ` בטלפון ${ownerPhone}` : ''}.`
        );
      }

      // A customer who repeats the question while waiting must not ping the
      // owner a second time — the owner sees a duplicate and the customer gets
      // two answers to one question.
      const existing = tickets.findDuplicate(chatId, q);
      if (existing) {
        return (
          `השאלה הזו כבר הועברה לבעל העסק (#${existing.id}) ועדיין אין תשובה. ` +
          'אל תעביר אותה שוב. אמור ללקוח במשפט אחד שאתה עדיין ממתין לתשובה ותחזור אליו.'
        );
      }

      const ticket = tickets.create({
        chatId,
        customerName,
        question: q,
        customerText,
      });

      const who = customerName ? `${customerName} (${senderPhone})` : senderPhone;
      const body =
        `❓ *שאלה שאין לי עליה תשובה* · #${ticket.id}\n` +
        `👤 ${who}\n` +
        `💬 הלקוח כתב: "${customerText}"\n\n` +
        `*${q}*\n\n` +
        '_ענו כאן בהודעה רגילה. התשובה תישלח ללקוח ותישמר במאגר הידע._\n' +
        '_כשיש כמה שאלות פתוחות — השיבו על ההודעה הזו או כתבו #' +
        `${ticket.id} בתחילת התשובה._`;

      const { idMessage } = await sendMessage(config.ownerGroupChatId, body);
      tickets.attachGroupMessage(ticket.id, idMessage);
      console.log(`[ask] #${ticket.id} ${senderPhone}: ${q}`);

      return (
        `השאלה הועברה לבעל העסק בקבוצה הפנימית (#${ticket.id}). ` +
        'אמור ללקוח במשפט אחד שאתה בודק את זה מולו ותחזור אליו עם תשובה. ' +
        'אל תמציא תשובה, אל תבטיח זמן מדויק, ואל תסיים את השיחה.'
      );
    },
  };
}
