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
function callOllamaChat(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
    });

    const options = {
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices[0].message.content);
        } catch (e) { reject(new Error('Groq parse error')); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
