import config from './config.js';

const { idInstance, token, baseUrl } = config.greenApi;

// Note the token position: it is the LAST path segment, after the method name.
// Putting it anywhere else returns a bare 403 with no explanation.
const url = (method) => `${baseUrl}/waInstance${idInstance}/${method}/${token}`;

export async function sendMessage(chatId, message) {
  const res = await fetch(url('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  if (!res.ok) throw new Error(`Green API sendMessage ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getStateInstance() {
  const res = await fetch(url('getStateInstance'));
  if (!res.ok) throw new Error(`Green API getStateInstance ${res.status}`);
  return res.json();
}

/** Point the instance's webhook at this deployment. */
export async function setWebhook(webhookUrl) {
  const res = await fetch(url('setSettings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookUrl,
      webhookUrlToken: '',
      incomingWebhook: 'yes',
      outgoingWebhook: 'no',
      outgoingMessageWebhook: 'no',
      outgoingAPIMessageWebhook: 'no',
      stateWebhook: 'no',
      deviceWebhook: 'no',
      pollMessageWebhook: 'no',
    }),
  });
  if (!res.ok) throw new Error(`Green API setSettings ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Create a WhatsApp group owned by the instance's number.
 * `participants` are plain phone numbers in international form (972…).
 * WhatsApp refuses to create an empty group, so at least one is required.
 */
export async function createGroup(groupName, participants) {
  const chatIds = participants.map((p) => `${String(p).replace(/\D/g, '')}@c.us`);
  const res = await fetch(url('createGroup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupName, chatIds }),
  });
  if (!res.ok) throw new Error(`Green API createGroup ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Text lives under a different key depending on the message type. */
export function extractText(messageData) {
  if (!messageData) return null;
  switch (messageData.typeMessage) {
    case 'textMessage':
      return messageData.textMessageData?.textMessage || null;
    case 'extendedTextMessage':
    case 'quotedMessage':
      return messageData.extendedTextMessageData?.text || null;
    default:
      return null;
  }
}

/**
 * Id of the message this one replies to, when the sender used WhatsApp's quote.
 * That id is how an owner's answer in the group is tied back to the question it
 * answers — the only unambiguous link when several questions are open at once.
 * Green API puts it under a different key per payload shape, hence the fallbacks.
 */
export function extractQuotedId(messageData) {
  return (
    messageData?.quotedMessage?.stanzaId ||
    messageData?.extendedTextMessageData?.stanzaId ||
    null
  );
}
