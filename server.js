// ==============================================
// server.js - v4.3 (Legacy Stability Mode)
// ==============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const { removeBackground } = require('@imgly/background-removal-node');

const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(k => k);

if (API_KEYS.length === 0) {
  console.error('❌ Missing GEMINI_API_KEY');
  process.exit(1);
}

const geminiClients = API_KEYS.map((key) => new GoogleGenerativeAI(key));
let currentKeyIndex = 0;

function getNextGeminiClient() {
  const client = geminiClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % geminiClients.length;
  return client;
}

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// تعليمات ريم مدمجة
const REEM_PROMPT_PREFIX = `أنتِ ريم، مساعدة ذكية وودودة. ردي بالعربية فقط وبأسلوب لطيف. لا تذكري جوجل.\nالمستخدم يسأل: `;

async function generateWithRobustFallback(parts) {
  // تجربة gemini-pro أولاً لأنه الأكثر توافقاً مع كل المفاتيح
  const models = ['gemini-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'];
  let lastError;

  for (const m of models) {
    try {
      console.log(`🚀 Trying model: ${m}`);
      const client = getNextGeminiClient();
      const model = client.getGenerativeModel({ model: m });

      const result = await model.generateContent(parts);
      const response = await result.response;
      return response.text();
    } catch (err) {
      console.warn(`❌ Model ${m} failed:`, err.message);
      lastError = err;
      continue;
    }
  }
  throw lastError;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, image } = req.body;
    const combinedPrompt = REEM_PROMPT_PREFIX + (message || 'مرحباً');
    const parts = [{ text: combinedPrompt }];

    if (image) {
      const match = image.match(/^data:([a-z\/+-]+);base64,(.+)$/);
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }

    const reply = await generateWithRobustFallback(parts);
    res.json({ success: true, reply });
  } catch (error) {
    console.error('Final Error:', error.message);
    res.status(500).json({ success: false, error: 'حدث خطأ في الاتصال. تأكدي من صلاحية المفتاح.' });
  }
});

app.post('/api/generate-image', (req, res) => {
  const { prompt } = req.body;
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt || 'beauty')}?width=1024&height=1024&nologo=true&seed=${Math.random()}`;
  res.json({ success: true, imageUrl });
});

app.post('/api/remove-bg', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false });
    const resultBlob = await removeBackground(new Blob([req.file.buffer], { type: req.file.mimetype }));
    const base64 = Buffer.from(await resultBlob.arrayBuffer()).toString('base64');
    res.json({ success: true, imageUrl: `data:image/png;base64,${base64}` });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/reset', (req, res) => res.json({ success: true }));

app.listen(PORT, () => console.log(`✅ Server v4.3 (Legacy Mode) on port ${PORT}`));
