const fetch = require('node-fetch');

/**
 * Generic HTTP(S) SMS gateway caller (Admin > Marketing > SMS).
 * Most Bangladeshi bulk-SMS providers (and many others) expose a simple
 * GET endpoint with the API key / sender ID / recipient / message as query
 * params — there's no one standard shape, so instead of hard-coding one
 * provider, `apiUrl` is a template the admin fills in with their own
 * provider's exact query string, using these placeholders:
 *   {apiKey}    -> sms.apiKey
 *   {senderId}  -> sms.senderId
 *   {number}    -> the recipient's number, passed to sendSms()
 *   {message}   -> the message text, passed to sendSms()
 * e.g. https://api.example-sms-bd.com/sendtext?apikey={apiKey}&senderid={senderId}&contacts={number}&msg={message}
 *
 * This performs a REAL HTTP GET to that URL and returns the gateway's raw
 * response — every caller must wrap this in try/catch, since an
 * unconfigured or unreachable gateway must never break checkout or block
 * an admin action.
 */
function fillTemplate(template, vars) {
  return Object.keys(vars).reduce(
    (str, key) => str.split(`{${key}}`).join(encodeURIComponent(vars[key] == null ? '' : vars[key])),
    template
  );
}

async function sendSms(config, number, message) {
  if (!config || !config.status) {
    throw new Error('The SMS gateway is turned OFF. Turn it ON and save before testing.');
  }
  if (!config.apiUrl) {
    throw new Error('No API URL configured for the SMS gateway.');
  }
  if (!number || !String(number).trim()) {
    throw new Error('Enter a recipient phone number.');
  }

  const filledUrl = fillTemplate(config.apiUrl, {
    apiKey: config.apiKey || '',
    senderId: config.senderId || '',
    number: String(number).trim(),
    message: message || '',
  });

  let target;
  try {
    target = new URL(filledUrl);
  } catch (err) {
    throw new Error('The configured API URL is not a valid URL once filled in.');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('The API URL must be an http:// or https:// address.');
  }

  const res = await fetch(target.toString(), { method: 'GET', timeout: 15000 });
  const body = await res.text();
  return { statusCode: res.status, ok: res.ok, body: body.slice(0, 1000) };
}

module.exports = { sendSms, fillTemplate };
