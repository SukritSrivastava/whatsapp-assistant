// Sets up the Baileys connection to WhatsApp Web using the secondary number.
// On first run this will print a QR code in the terminal — scan it from
// WhatsApp on the secondary phone/number: Settings -> Linked Devices -> Link
// a Device.

const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');

/**
 * @param {object} handlers
 * @param {(msg: object) => Promise<void>} handlers.onMessage - called for every relevant incoming message
 * @returns {Promise<import('@whiskeysockets/baileys').WASocket>}
 */
async function connectWhatsApp({ onMessage }) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'warn' }),
    printQRInTerminal: false, // we handle QR ourselves for a clearer prompt
    browser: ['WhatsApp Assistant', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with the SECONDARY number (WhatsApp -> Linked Devices -> Link a Device):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`[whatsapp] connection closed (code ${statusCode}). Logged out: ${loggedOut}`);
      if (!loggedOut) {
        console.log('[whatsapp] reconnecting...');
        connectWhatsApp({ onMessage }).catch((err) => console.error('[whatsapp] reconnect failed:', err));
      } else {
        console.log('[whatsapp] session logged out. Delete the data/auth folder and restart to re-link.');
      }
    } else if (connection === 'open') {
      console.log('[whatsapp] connected.');
    }
  });

    sock.ev.on('messages.upsert', async (upsert) => {
    console.log('[debug] messages.upsert fired:', JSON.stringify(upsert, null, 2));
    const { messages, type } = upsert;
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await onMessage(sock, msg);
      } catch (err) {
        console.error('[whatsapp] error handling message:', err);
      }
    }
  });

  return sock;
}

module.exports = { connectWhatsApp };
