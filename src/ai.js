const router = require('express').Router();
const https  = require('https');
const { verifyToken } = require('./middleware/auth');

router.use(verifyToken);

// ─────────────────────────────────────────────────────────────
// UTIL: HTTP REQUEST WRAPPER WITH TIMEOUT
// ─────────────────────────────────────────────────────────────
function httpRequest(options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';

      res.on('data', chunk => { data += chunk; });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────
function buildOfflinePrompt(symptoms) {
  return `
You are a cautious medical assistant.

Analyze the symptoms and return JSON:
{
  "possible_conditions": [],
  "severity": "low | medium | high",
  "advice": "",
  "need_doctor": true/false
}

IMPORTANT:
- Do NOT give final diagnosis
- If serious symptoms → recommend emergency care

Symptoms: ${symptoms}
`;
}

function buildOnlinePrompt(symptoms, location) {
  return `
You are an AI medical assistant.

User location: ${location || 'unknown'}

Return STRICT JSON:
{
  "possible_conditions": [],
  "severity": "low | medium | high",
  "advice": "",
  "need_doctor": true/false
}

Safety rules:
- No definitive diagnosis
- If chest pain, stroke signs, breathing issues → EMERGENCY

Symptoms: ${symptoms}
`;
}

function buildDoctorSystemPrompt(location, mode) {
  return `
You are a helpful, cautious AI doctor.

Context:
- Mode: ${mode}
- Location: ${location || 'unknown'}

Rules:
- Never give a final diagnosis
- Suggest possibilities only
- Encourage doctor visit when needed
- If emergency symptoms appear → say "Seek immediate medical help"

Be conversational, clear, and safe.
`;
}

// ─────────────────────────────────────────────────────────────
// GROQ (OFFLINE MODE)
// ─────────────────────────────────────────────────────────────
async function callGroq(messages) {
  const payload = JSON.stringify({
    model: 'llama3-8b-8192',
    messages
  });

  const res = await httpRequest({
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  return res.choices?.[0]?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────
// ANTHROPIC (ONLINE MODE)
// ─────────────────────────────────────────────────────────────
async function callAnthropic(systemPrompt, messages) {
  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });

  const res = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  const text = (res.content || [])
    .map(b => b.text || '')
    .join('')
    .trim();

  return text;
}

// ─────────────────────────────────────────────────────────────
// SAFE JSON PARSER
// ─────────────────────────────────────────────────────────────
function safeJSONParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTE: ANALYSE (SINGLE SHOT)
// ─────────────────────────────────────────────────────────────
router.post('/analyse', async (req, res) => {
  const { symptoms, mode = 'online', location } = req.body;

  if (!symptoms) {
    return res.status(400).json({ error: 'symptoms required' });
  }

  if (!['online', 'offline'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
    // OFFLINE (Groq)
    if (mode === 'offline') {
      const prompt = buildOfflinePrompt(symptoms);

      const text = await callGroq([
        { role: 'user', content: prompt }
      ]);

      return res.json({
        result: safeJSONParse(text),
        mode: 'offline',
        source: 'groq'
      });
    }

    // ONLINE (Anthropic)
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const text = await callAnthropic(
      '',
      [{ role: 'user', content: buildOnlinePrompt(symptoms, location) }]
    );

    return res.json({
      result: safeJSONParse(text),
      mode: 'online',
      source: 'anthropic'
    });

  } catch (err) {
    console.error('Analyse error:', err.message);

    // fallback → Groq
    try {
      const text = await callGroq([
        { role: 'user', content: buildOfflinePrompt(symptoms) }
      ]);

      return res.json({
        result: safeJSONParse(text),
        mode: 'offline',
        source: 'groq_fallback'
      });
    } catch {
      return res.status(502).json({
        error: 'Both AI services failed'
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE: CHAT (MULTI-TURN)
// ─────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages, mode = 'online', location } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  const systemPrompt = buildDoctorSystemPrompt(location, mode);

  try {
    // OFFLINE
    if (mode === 'offline') {
      const reply = await callGroq([
        { role: 'system', content: systemPrompt },
        ...messages
      ]);

      return res.json({
        reply,
        mode: 'offline',
        source: 'groq'
      });
    }

    // ONLINE
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const reply = await callAnthropic(systemPrompt, messages);

    return res.json({
      reply,
      mode: 'online',
      source: 'anthropic'
    });

  } catch (err) {
    console.error('Chat error:', err.message);

    // fallback
    try {
      const reply = await callGroq([
        { role: 'system', content: systemPrompt },
        ...messages
      ]);

      return res.json({
        reply,
        mode: 'offline',
        source: 'groq_fallback'
      });
    } catch {
      return res.status(502).json({
        error: 'AI chat unavailable'
      });
    }
  }
});

module.exports = router;