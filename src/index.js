import http from 'node:http';
import config from './config.js';
import { answer, resolveOwnerAnswer } from './agent.js';
import { getHistory, remember, rememberAssistant, forget } from './memory.js';
import { sendMessage, extractText, extractQuotedId, getStateInstance } from './green-api.js';
import { addFact } from './knowledge.js';
import * as tickets from './tickets.js';
import { homePage, catalogPage, categoryPage, productPage, infoPage } from './site.js';

const seen = new Set(); // Green API redelivers on timeout; dedupe by message id.

function isAllowed(senderPhone) {
  if (!config.allowedSenders.length) return true; // open to all customers
  return config.allowedSenders.some(
    (s) => s.replace(/\D/g, '') === senderPhone.replace(/\D/g, '')
  );
}

/**
 * The owner answered a forwarded question in the internal group.
 * Sends the answer on to the customer who is still waiting, and keeps the fact.
 */
async function handleOwnerAnswer(messageData, text) {
  const group = config.ownerGroupChatId;

  // Quoting the question message is the only unambiguous link, so it is tried
  // first; "#7" written by hand is the manual equivalent.
  let ticket = tickets.byGroupMessageId(extractQuotedId(messageData));
  const tagged = text.match(/#(\d+)/);
  if (!ticket && tagged) ticket = tickets.byId(tagged[1]);

  if (!ticket) {
    const open = tickets.openTickets();
    // Nothing is pending, so this is the owner talking in the group. Staying
    // silent here is what makes the group usable for anything else.
    if (!open.length) return;
    if (open.length === 1) [ticket] = open;
    else {
      await sendMessage(
        group,
        'יש כמה שאלות פתוחות ולא ידעתי לאיזו מהן התכוונת. השיבו על ההודעה של השאלה עצמה, ' +
          'או פתחו את התשובה במספר שלה:\n' +
          open.map((t) => `#${t.id} — ${t.question}`).join('\n')
      );
      return;
    }
  }

  const { answered, reply, fact } = await resolveOwnerAnswer({
    question: ticket.question,
    customerText: ticket.customerText,
    ownerText: text,
    customerName: ticket.customerName,
  });

  // "רגע, בודק" is not an answer. Leaving the ticket open means the real answer,
  // whenever it comes, still finds its way to the customer.
  if (!answered || !reply) return;

  await sendMessage(ticket.chatId, reply);
  rememberAssistant(ticket.chatId, reply);
  const saved = fact ? addFact({ question: ticket.question, fact }) : null;
  tickets.close(ticket.id, { answer: text, reply });
  console.log(`[ans] #${ticket.id} → ${ticket.chatId}: ${reply}`);

  await sendMessage(
    group,
    `✅ נשלח ל${ticket.customerName || ticket.chatId.replace('@c.us', '')} (#${ticket.id}):\n` +
      `"${reply}"\n\n` +
      (saved
        ? `📚 נשמר במאגר הידע: "${saved.fact}"`
        : '📚 לא נשמר במאגר — התשובה נראית נכונה ללקוח הזה בלבד.')
  );
}

async function handleMessage(body) {
  const { senderData, messageData, idMessage } = body;
  if (!senderData || !messageData) return;

  const chatId = senderData.chatId;

  if (seen.has(idMessage)) return;
  seen.add(idMessage);
  if (seen.size > 1000) seen.clear();

  // The internal group is the one group the agent listens to, and it never gets
  // a customer-style answer — only ticket handling.
  if (config.ownerGroupChatId && chatId === config.ownerGroupChatId) {
    const groupText = extractText(messageData)?.trim();
    if (!groupText) return;
    console.log(`[grp] ${senderData.sender || ''}: ${groupText}`);
    await handleOwnerAnswer(messageData, groupText).catch(async (err) => {
      console.error('[error] group', err.message);
      // Silence here would read as "sent" — the owner has to know it was not.
      await sendMessage(
        config.ownerGroupChatId,
        `⚠️ לא הצלחתי להעביר את התשובה ללקוח: ${err.message}`
      ).catch(() => {});
    });
    return;
  }

  // Every other group is ignored: a shop bot answering inside group chats is a
  // fast way to get the number reported and blocked.
  if (!chatId?.endsWith('@c.us')) return;

  const senderPhone = chatId.replace('@c.us', '');
  if (!isAllowed(senderPhone)) {
    console.log(`[skip] מספר לא מורשה: ${senderPhone}`);
    return;
  }

  const text = extractText(messageData);
  if (!text?.trim()) return;

  console.log(`[in ] ${senderPhone}: ${text}`);

  if (text.trim() === '/reset') {
    forget(chatId);
    await sendMessage(chatId, 'השיחה אופסה.');
    return;
  }

  const { reply } = await answer({
    text: text.trim(),
    senderPhone,
    chatId,
    history: getHistory(chatId),
  });

  if (!reply) return;
  await sendMessage(chatId, reply);
  remember(chatId, text.trim(), reply);
  console.log(`[out] ${senderPhone}: ${reply}`);
}

const html = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    homePage()
      .then((body) => html(res, 200, body))
      .catch((err) => html(res, 500, `<h1>שגיאה בטעינת הקטלוג</h1><p>${err.message}</p>`));
    return;
  }

  if (req.method === 'GET') {
    const path = req.url.split('?')[0];
    const routes = [
      [/^\/catalog$/, () => catalogPage()],
      [/^\/info$/, () => infoPage()],
      [/^\/c\/(.+)$/, (m) => categoryPage(decodeURIComponent(m[1]))],
      [/^\/p\/([\w-]+)$/, (m) => productPage(m[1])],
    ];
    for (const [re, handler] of routes) {
      const m = path.match(re);
      if (!m) continue;
      handler(m)
        .then((body) =>
          body
            ? html(res, 200, body)
            : html(res, 404, '<h1>העמוד לא נמצא</h1><a href="/">חזרה לאתר</a>')
        )
        .catch((err) => html(res, 500, `<h1>שגיאה</h1><p>${err.message}</p>`));
      return;
    }
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model: config.openrouter.model }));
    return;
  }

  if (req.method !== 'POST' || !req.url.startsWith('/webhook')) {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    // Answer Green API before doing any work. It retries anything slow, and a
    // retry means the customer gets the same reply twice.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return;
    }
    if (body.typeWebhook !== 'incomingMessageReceived') return;

    handleMessage(body).catch((err) => console.error('[error]', err.message));
  });
});

server.listen(config.port, async () => {
  console.log(`הסוכן עלה על פורט ${config.port} · מודל ${config.openrouter.model}`);
  try {
    const { stateInstance } = await getStateInstance();
    console.log(`מצב Green API: ${stateInstance}`);
    if (stateInstance !== 'authorized') {
      console.warn('האינסטנס לא מחובר. סרקו QR בקונסולה של Green API, או לחצו אתחול.');
    }
  } catch (err) {
    console.error('בדיקת Green API נכשלה:', err.message);
  }
});
