const router = require('express').Router();
const https  = require('https');
const http   = require('http');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

// ─── POST /api/ai/analyse ─────────────────────────────────────────────────────
router.post('/analyse', async (req, res) => {
  const { symptoms, mode, location } = req.body;
  if (!symptoms) return res.status(400).json({ error: 'symptoms required' });

  try {
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
    }
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages, mode, location } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages array required' });

  const system = doctorSystemPrompt(location, mode);

  try {
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
    }
  }
});

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
