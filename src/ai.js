const router = require('express').Router();
const https  = require('https');
<<<<<<< HEAD
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
=======
const http   = require('http');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

// ─── POST /api/ai/analyse ─────────────────────────────────────────────────────
>>>>>>> 6d5a8bfa54f56bbabd39949221072c6050e158f1
router.post('/analyse', async (req, res) => {
  const { symptoms, mode = 'online', location } = req.body;

  if (!symptoms) {
    return res.status(400).json({ error: 'symptoms required' });
  }

  if (!['online', 'offline'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
<<<<<<< HEAD
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
=======
    const prompt = mode === 'offline' ? offlinePrompt(symptoms) : onlinePrompt(symptoms, location);
    const result = await callAnthropic(prompt);
    return res.json({ result, mode, source: 'anthropic' });
  } catch (err) {
    console.error('Analyse error:', err.message);
    // fallback to Groq if Anthropic fails
    try {
      const prompt = mode === 'offline' ? offlinePrompt(symptoms) : onlinePrompt(symptoms, location);
      const result = await callGroq([{ role: 'user', content: prompt }]);
      const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
      return res.json({ result: parsed, mode, source: 'groq_fallback' });
    } catch (e) {
      return res.status(502).json({ error: 'AI service unavailable: ' + err.message });
>>>>>>> 6d5a8bfa54f56bbabd39949221072c6050e158f1
    }
  }
});

<<<<<<< HEAD
// ─────────────────────────────────────────────────────────────
// ROUTE: CHAT (MULTI-TURN)
// ─────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages, mode = 'online', location } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }
=======
// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages, mode, location } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages array required' });
>>>>>>> 6d5a8bfa54f56bbabd39949221072c6050e158f1

  const system = doctorSystemPrompt(location, mode);

  try {
<<<<<<< HEAD
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
=======
    const reply = await callAnthropicChat(system, messages);
    return res.json({ reply, mode, source: 'anthropic' });
  } catch (err) {
    console.error('Chat error:', err.message);
    try {
      const groqMsgs = [{ role: 'system', content: system }, ...messages];
      const reply = await callGroq(groqMsgs);
      return res.json({ reply, mode, source: 'groq_fallback' });
    } catch (e) {
      return res.status(502).json({ error: 'AI chat unavailable: ' + err.message });
>>>>>>> 6d5a8bfa54f56bbabd39949221072c6050e158f1
    }
  }
});

<<<<<<< HEAD
module.exports = router;
=======
// ─── Anthropic ────────────────────────────────────────────────────────────────
function callAnthropic(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.env.ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY not set'));
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(p.error.message));
          const text = p.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
          resolve(JSON.parse(text));
        } catch (e) { reject(new Error('Anthropic parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function callAnthropicChat(system, messages) {
  return new Promise((resolve, reject) => {
    if (!process.env.ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY not set'));
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(p.error.message));
          resolve(p.content.map(b => b.text || '').join('').trim());
        } catch (e) { reject(new Error('Anthropic chat parse error')); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

// ─── Groq fallback (free Llama3) ──────────────────────────────────────────────
function callGroq(messages) {
  return new Promise((resolve, reject) => {
    if (!process.env.GROQ_API_KEY) return reject(new Error('GROQ_API_KEY not set'));
    const payload = JSON.stringify({ model: 'llama3-8b-8192', messages, temperature: 0.3 });
    const req = https.request({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(p.error.message));
          resolve(p.choices[0].message.content);
        } catch (e) { reject(new Error('Groq parse error')); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
function onlinePrompt(symptoms, location) {
  const loc = location?.city
    ? `User location: ${location.city} (lat: ${location.lat}, lng: ${location.lng}).`
    : 'User location: India (not specified).';
  return `You are Arogya, a trusted AI medical assistant. ${loc}
Patient symptoms: "${symptoms}"
Return ONLY valid JSON (no markdown, no backticks):
{"summary":"2-3 sentence plain assessment","possibleConditions":["cond1","cond2"],"specialistType":"e.g. General Physician","urgency":"routine","doctors":[{"name":"Dr. Indian Name","spec":"Specialisation","distance":"0.8 km","rating":4.7,"hospital":"Hospital near ${location?.city || 'the user'}","type":"nearby"},{"name":"Dr. Indian Name","spec":"Specialisation","distance":"1.5 km","rating":4.8,"hospital":"Hospital near ${location?.city || 'the user'}","type":"nearby"},{"name":"Dr. Indian Name","spec":"Specialisation","distance":"Remote","rating":5.0,"hospital":"Kokilaben or Fortis Mumbai","type":"best"}],"warning":""}
urgency must be: routine | soon | urgent | emergency. Use realistic Indian doctor and hospital names.`;
}

function offlinePrompt(symptoms) {
  return `You are Arogya, a doctor giving safe home advice when no clinic is reachable.
Patient symptoms: "${symptoms}"
Return ONLY valid JSON (no markdown, no backticks):
{"summary":"2-3 sentence assessment","likelyCause":"most likely cause","remedies":["step 1","step 2","step 3","step 4"],"avoidList":["avoid 1","avoid 2"],"seekDoctorIf":"when to urgently see a doctor","warning":""}
Include safe ayurvedic and evidence-based Indian home remedies.`;
}

function doctorSystemPrompt(location, mode) {
  const loc = location?.city ? `Patient location: ${location.city}.` : 'Patient location: India.';
  if (mode === 'offline') {
    return `You are Arogya, a compassionate doctor chatting with a patient who has no internet or clinic access. ${loc}
- Ask about symptoms in a warm, friendly doctor-like way
- Gather details one question at a time (duration, severity, age, known conditions)
- Give safe home remedies, Ayurvedic cures, what to avoid, and when to urgently see a doctor
- Never recommend prescription drugs
- Keep responses concise — this is a chat, not an essay
- Always remind them to see a real doctor when connectivity is restored`;
  }
  return `You are Arogya, a compassionate AI doctor having a real conversation with a patient. ${loc}
- Talk like a warm, professional doctor
- Ask follow-up questions to understand symptoms (duration, severity, triggers, age, pre-existing conditions)
- After enough info: give likely condition, urgency level, specialist type, and nearby doctor suggestions for their location
- Give brief actionable advice for immediate relief
- Be honest about uncertainty — say what a doctor needs to confirm
- Keep responses to 3-5 sentences unless explaining something complex
- Never diagnose definitively — always recommend professional confirmation`;
}

module.exports = router;
>>>>>>> 6d5a8bfa54f56bbabd39949221072c6050e158f1
