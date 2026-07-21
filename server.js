// ==============================================
// server.js - v4.1 (Maximum Robustness for Gemini 404)
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
  console.error('❌ Error: GEMINI_API_KEY is missing from .env');
  process.exit(1);
}

const geminiClients = API_KEYS.map((key) => new GoogleGenerativeAI(key));
let currentKeyIndex = 0;

function getNextGeminiClient() {
  const client = geminiClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % geminiClients.length;
  return client;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const REEM_SYSTEM_INSTRUCTION = `أنتِ "ريم"، مساعدة ذكية وودودة. تجيبين بالعربية فقط. اسمك ريم. لا تذكري جوجل أو جيمناي.`;

// قائمة بجميع أسماء الموديلات الممكنة لتجاوز خطأ 404
const MODELS_TO_TRY = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-2.0-flash-exp',
  'gemini-pro'
];

async function generateWithFallback(parts) {
  let lastError;

  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`🔍 Attempting with model: ${modelName}...`);
      const client = getNextGeminiClient();
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: REEM_SYSTEM_INSTRUCTION,
      });

      const result = await model.generateContent(parts);
      const response = await result.response;
      console.log(`✅ Success with model: ${modelName}`);
      return response;
    } catch (err) {
      console.warn(`⚠️ Model ${modelName} failed:`, err.message);
      lastError = err;
      // إذا كان الخطأ 404 (غير موجود) أو 400 (غير مدعوم)، نجرب الموديل التالي
      if (err.message.includes('404') || err.message.includes('not found') || err.message.includes('supported')) {
        continue;
      }
      // إذا كان الخطأ في المفتاح أو الحصة (429)، نتوقف
      break;
    }
  }
  throw lastError;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, image } = req.body;
    const parts = [];

    if (image) {
      const match = image.match(/^data:([a-z\/+-]+);base64,(.+)$/);
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }

    parts.push({ text: message || 'مرحباً' });

    const response = await generateWithFallback(parts);
    res.json({ success: true, reply: response.text() });
  } catch (error) {
    console.error('Final Gemini Error:', error.message);
    res.status(500).json({ success: false, error: 'تعذّر الاتصال بـ Gemini. تأكدي من صلاحية المفتاح ودعمه للموديلات.' });
  }
});

app.post('/api/generate-image', (req, res) => {
  const { prompt } = req.body;
  const seed = Math.floor(Math.random() * 1000000);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt || 'beauty')}?width=1024&height=1024&nologo=true&seed=${seed}`;
  res.json({ success: true, imageUrl });
});

app.post('/api/remove-bg', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image' });
    const resultBlob = await removeBackground(new Blob([req.file.buffer], { type: req.file.mimetype }));
    const base64 = Buffer.from(await resultBlob.arrayBuffer()).toString('base64');
    res.json({ success: true, imageUrl: `data:image/png;base64,${base64}` });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/reset', (req, res) => res.json({ success: true }));

app.listen(PORT, () => console.log(`✅ Server v4.1 running on port ${PORT}`));
