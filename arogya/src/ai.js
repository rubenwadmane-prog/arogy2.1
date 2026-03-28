const router = require('express').Router();
const https  = require('https');
const http   = require('http');
const { verifyToken } = require('./middleware/auth');

router.use(verifyToken);

// ─── POST /api/ai/analyse ─────────────────────────────────────────────────────
// Single-shot symptom analysis
// Online  → Anthropic Claude (server-side, key never reaches browser)
// Offline → Ollama (local LLM running on the server / Railway sidecar)
router.post('/analyse', async (req, res) => {
  const { symptoms, mode, location } = req.body;
  if (!symptoms) return res.status(400).json({ error: 'symptoms required' });

  try {
    if (mode === 'offline') {
      const result = await callOllama(buildOfflinePrompt(symptoms));
      return res.json({ result, mode: 'offline', source: 'ollama' });
    }

    // online — Anthropic
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    const result = await callAnthropic(buildOnlinePrompt(symptoms, location));
    return res.json({ result, mode: 'online', source: 'anthropic' });

  } catch (err) {
    console.error('AI analyse error:', err.message);
    // If Anthropic fails, try Ollama as fallback
    try {
      console.log('Anthropic failed, falling back to Ollama...');
      const result = await callOllama(buildOfflinePrompt(symptoms));
      return res.json({ result, mode: 'offline', source: 'ollama_fallback' });
    } catch (ollamaErr) {
      return res.status(502).json({ error: 'Both AI services unavailable: ' + err.message });
    }
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Conversational doctor chat — multi-turn
// Frontend sends full conversation history each time
router.post('/chat', async (req, res) => {
  const { messages, mode, location } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const systemPrompt = buildDoctorSystemPrompt(location, mode);

  try {
    if (mode === 'offline') {
      const reply = await callOllamaChat(systemPrompt, messages);
      return res.json({ reply, mode: 'offline', source: 'ollama' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    const reply = await callAnthropicChat(systemPrompt, messages);
    return res.json({ reply, mode: 'online', source: 'anthropic' });

  } catch (err) {
    console.error('AI chat error:', err.message);
    try {
      const reply = await callOllamaChat(systemPrompt, messages);
      return res.json({ reply, mode: 'offline', source: 'ollama_fallback' });
    } catch (ollamaErr) {
      return res.status(502).json({ error: 'AI chat unavailable: ' + err.message });
    }
  }
});

// ─── Anthropic helpers ────────────────────────────────────────────────────────

function callAnthropic(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = (parsed.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('Failed to parse Anthropic response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function callAnthropicChat(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   messages.map(m => ({ role: m.role, content: m.content })),
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = (parsed.content || []).map(b => b.text || '').join('').trim();
          resolve(text);
        } catch (e) {
          reject(new Error('Failed to parse Anthropic chat response'));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Ollama helpers ───────────────────────────────────────────────────────────

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const ollamaUrl  = process.env.OLLAMA_URL || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3';
    const url = new URL(ollamaUrl);

    const payload = JSON.stringify({
      model:  ollamaModel,
      prompt: prompt,
      stream: false,
      options: { temperature: 0.3 },
    });

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     '/api/generate',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text   = (parsed.response || '').replace(/```json|```/g, '').trim();
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('Failed to parse Ollama response: ' + e.message));
        }
      });
    });
    req.on('error', err => reject(new Error('Ollama unreachable: ' + err.message)));
    req.write(payload);
    req.end();
  });
}

function callOllamaChat(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const ollamaUrl   = process.env.OLLAMA_URL || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3';
    const url = new URL(ollamaUrl);

    // Build Ollama chat messages format
    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    const payload = JSON.stringify({
      model:    ollamaModel,
      messages: ollamaMessages,
      stream:   false,
      options:  { temperature: 0.4 },
    });

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     '/api/chat',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.message?.content || parsed.response || '');
        } catch (e) {
          reject(new Error('Failed to parse Ollama chat response'));
        }
      });
    });
    req.on('error', err => reject(new Error('Ollama unreachable: ' + err.message)));
    req.write(payload);
    req.end();
  });
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildOnlinePrompt(symptoms, location) {
  const loc = location
    ? `The user is located at coordinates: lat ${location.lat}, lng ${location.lng} (${location.city || 'India'}).`
    : 'The user is located in India (location not specified, use general Indian context).';

  return `You are Arogya, a trusted AI medical assistant. ${loc}
Patient symptoms: "${symptoms}"

Return ONLY a valid JSON object (no markdown, no backticks, no extra text):
{
  "summary": "2-3 sentence plain assessment of the likely condition",
  "possibleConditions": ["condition1", "condition2", "condition3"],
  "specialistType": "e.g. General Physician",
  "urgency": "routine",
  "doctors": [
    {"name":"Dr. Indian Name","spec":"Specialisation","distance":"0.8 km","rating":4.7,"hospital":"Hospital Name near user location","type":"nearby"},
    {"name":"Dr. Indian Name","spec":"Specialisation","distance":"1.5 km","rating":4.8,"hospital":"Hospital Name near user location","type":"nearby"},
    {"name":"Dr. Indian Name","spec":"Specialisation","distance":"Remote","rating":5.0,"hospital":"Top hospital like Kokilaben or Fortis","type":"best"}
  ],
  "warning": ""
}
urgency must be one of: routine, soon, urgent, emergency.
Use realistic Indian doctor names. Generate hospital names appropriate for the user's actual location if provided.`;
}

function buildOfflinePrompt(symptoms) {
  return `You are Arogya, an experienced doctor giving safe home advice when no clinic is reachable.
Patient symptoms: "${symptoms}"

Return ONLY a valid JSON object (no markdown, no backticks, no extra text):
{
  "summary": "2-3 sentence doctor-perspective assessment",
  "likelyCause": "most likely cause in plain language",
  "remedies": [
    "Detailed step 1 home remedy or action",
    "Detailed step 2",
    "Detailed step 3",
    "Detailed step 4"
  ],
  "avoidList": ["thing to avoid 1", "thing to avoid 2", "thing to avoid 3"],
  "seekDoctorIf": "specific condition or symptom that means they must see a doctor immediately",
  "warning": ""
}
Include safe ayurvedic and evidence-based home remedies appropriate for Indian context.`;
}

function buildDoctorSystemPrompt(location, mode) {
  const locCtx = location
    ? `The patient is located at lat ${location.lat}, lng ${location.lng} (${location.city || 'India'}).`
    : 'The patient is in India.';

  if (mode === 'offline') {
    return `You are Arogya, a compassionate and experienced doctor having a conversation with a patient who has no access to the internet or a clinic right now.
${locCtx}
Your job:
- Ask about symptoms in a warm, friendly, doctor-like manner
- Gather details one question at a time (duration, severity, associated symptoms, age, known conditions)
- After enough information, give safe home remedies, Ayurvedic cures where appropriate, what to avoid, and when to urgently seek a doctor
- Always be clear about what you can and cannot diagnose remotely
- Never recommend prescription drugs; suggest OTC options by category only
- Keep responses concise and conversational — this is a chat, not an essay
- End serious responses with a reminder to see a real doctor when connectivity is restored`;
  }

  return `You are Arogya, a compassionate and knowledgeable AI doctor having a real-time conversation with a patient.
${locCtx}
Your job:
- Talk like a warm, professional doctor — not like a chatbot
- Ask follow-up questions to understand symptoms better (duration, severity, triggers, age, pre-existing conditions)
- After gathering enough info, provide: likely condition, urgency level, what kind of specialist to see, and 2-3 nearby doctor suggestions appropriate to their location
- Give brief, actionable advice for immediate relief while they arrange a doctor's visit
- Be honest about uncertainty — say "this could be X or Y, a doctor needs to confirm"
- Keep responses focused and conversational — 3-5 sentences max per reply unless explaining something complex
- Never diagnose definitively — always recommend professional confirmation`;
}

module.exports = router;
