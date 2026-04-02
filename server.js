require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ──────────────────────────────────────────
const rateMap = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 60 * 1000;

function checkRate(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now - entry.start > RATE_WINDOW) rateMap.delete(ip);
  }
}, 10 * 60 * 1000);

// POST /api/questions
app.post('/api/questions', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!checkRate(ip)) {
    return res.status(429).json({
      error: "You've hit the limit! Come back in a bit."
    });
  }

  const { category = 'mixed', difficulty = 1, seen = [] } = req.body;
  const avoidList = seen.slice(-30).join(', ') || 'none yet';

  const prompt = `Generate exactly 8 face-off comparison questions for a trivia quiz game.

Category: ${category === 'mixed' ? 'any mix of history, geography, nature, science, pop-culture' : category}
Difficulty: ${difficulty}/5
- 1: Obvious answers (elephant vs mouse — which is heavier?)
- 2: Well-known items but requires some knowledge
- 3: Values closer together, less obvious winner
- 4: More obscure items or very close values
- 5: Niche, counterintuitive, or extremely close values

Do NOT repeat these pairs: ${avoidList}

Return ONLY a valid JSON array with no markdown. Each element must be:
{
  "itemA": { "name": "string", "value": "string with unit", "numericValue": number },
  "itemB": { "name": "string", "value": "string with unit", "numericValue": number },
  "comparison": "taller|heavier|older|faster|longer|bigger|more populated|more expensive|deeper|larger|hotter",
  "category": "history|geography|nature|science|pop-culture",
  "lowerIsCorrect": false,
  "funFact": "One interesting sentence about the winner."
}

IMPORTANT RULES:
- Every numericValue must be a plain number (no strings, no commas)
- Both items must be comparable (same domain: two buildings, two animals, etc.)
- lowerIsCorrect should be true ONLY for "older" comparisons where a lower year means older
- Values must be factually accurate
- Make the comparisons genuinely interesting and surprising`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = completion.choices[0].message.content.trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('No JSON array found:', raw.slice(0, 300));
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    let questions;
    try {
      questions = JSON.parse(match[0]);
    } catch (e) {
      let fixed = match[0].replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');
      if (!fixed.endsWith(']')) {
        const last = fixed.lastIndexOf('}');
        if (last > 0) fixed = fixed.slice(0, last + 1) + ']';
      }
      questions = JSON.parse(fixed);
    }

    // Filter out bad questions (tied values, non-numeric)
    questions = questions.filter(q => {
      const a = Number(q.itemA?.numericValue);
      const b = Number(q.itemB?.numericValue);
      return !isNaN(a) && !isNaN(b) && a !== b && q.itemA?.name && q.itemB?.name;
    });

    console.log(`[${ip}] Generated ${questions.length} questions (difficulty ${difficulty}, category ${category})`);
    res.json({ questions });
  } catch (err) {
    console.error('Groq API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`\n  Face-Off Quiz running at http://localhost:${port}\n`);
});
