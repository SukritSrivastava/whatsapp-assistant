// Wraps the Google Gemini API call that decides what to do with an incoming
// message: ignore it, auto-reply, or draft a reply and hold it for approval.
//
// Gemini has a genuinely free tier (no credit card required) via Google AI
// Studio: https://aistudio.google.com/apikey
//
// This uses plain fetch() (built into modern Node.js, no extra package
// needed) rather than an SDK, to keep dependencies minimal.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    classification: {
      type: 'STRING',
      enum: ['auto', 'approve', 'ignore'],
      description:
        "'auto' = safe to send the reply immediately without asking the owner. " +
        "'approve' = draft a reply but the owner must approve it first. " +
        "'ignore' = no reply needed at all (e.g. spam, or a message that doesn't need a response).",
    },
    reply: {
      type: 'STRING',
      description:
        "The drafted reply text, in the owner's voice. Use an empty string if classification is 'ignore'.",
    },
    reason: {
      type: 'STRING',
      description: "One short sentence explaining the classification, for the owner's own logs.",
    },
  },
  required: ['classification', 'reply', 'reason'],
};

function buildSystemPrompt(rules) {
  const facts = (rules.customFacts || []).filter((f) => f && !f.startsWith('Add short standing facts'));
  return [
    rules.persona,
    '',
    'You are triaging ONE incoming WhatsApp message from a real person and deciding how to handle it.',
    '',
    'Reply automatically (classification "auto") ONLY for things like:',
    ...(rules.autoReplyGuidance || []).map((g) => `- ${g}`),
    '',
    'Always hold for the owner\'s approval (classification "approve") for things like:',
    ...(rules.alwaysAskGuidance || []).map((g) => `- ${g}`),
    '',
    'Use "ignore" (empty reply) for things like:',
    ...(rules.ignoreGuidance || []).map((g) => `- ${g}`),
    '',
    facts.length ? `Standing facts you can rely on:\n${facts.map((f) => `- ${f}`).join('\n')}` : '',
    '',
    'When in doubt between "auto" and "approve", choose "approve" — it is always safe to ask the owner, ' +
      'and never safe to send something wrong or out of character as if the owner said it themselves.',
    'Keep drafted replies short and natural, matching how the owner actually texts.',
    '',
    'Respond ONLY with JSON matching the required schema — no extra commentary.',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatHistory(history) {
  if (!history.length) return 'No prior conversation with this contact.';
  return history
    .map((h) => `${h.role === 'me' ? 'Owner' : 'Them'}: ${h.text}`)
    .join('\n');
}

/**
 * @param {object} opts
 * @param {object} opts.rules - parsed config/rules.json
 * @param {string} opts.contactName - display name or number of the sender
 * @param {Array<{role: 'me'|'them', text: string}>} opts.history - recent conversation
 * @param {string} opts.incomingText - the new message text to react to
 * @returns {Promise<{classification: 'auto'|'approve'|'ignore', reply: string, reason: string}>}
 */
async function decideReply({ rules, contactName, history, incomingText }) {
  if (!API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Set it in your .env file.');
  }

  const system = buildSystemPrompt(rules);
  const userMessage = [
    `Contact: ${contactName}`,
    '',
    'Recent conversation history (most recent last):',
    formatHistory(history),
    '',
    `New incoming message from ${contactName}:`,
    incomingText,
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return { classification: 'approve', reply: '', reason: 'Model returned no content (possibly blocked by safety filters).' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { classification: 'approve', reply: '', reason: 'Could not parse model output as JSON.' };
  }

  return {
    classification: parsed.classification,
    reply: parsed.reply || '',
    reason: parsed.reason || '',
  };
}

module.exports = { decideReply };
