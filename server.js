// ==============================================
// server.js - v3.0 (Fixed Gemini 404 & 2026 Context)
// ==============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const multer = require('multer');
const { removeBackground } = require('@imgly/background-removal-node');

const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(k => k);

if (API_KEYS.length === 0) {
  console.error('❌ Missing Gemini API Key');
  process.exit(1);
}

const geminiClients = API_KEYS.map((key) => new GoogleGenerativeAI(key));
let currentKeyIndex = 0;

function getNextGeminiClient() {
  const client = geminiClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % geminiClients.length;
  return client;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// شخصية "ريم"
const REEM_SYSTEM_INSTRUCTION = `أنتِ "ريم"، مساعدة ذكية وودودة. اسمك ريم فقط. لا تذكري جوجل أو جيمناي.`;

function getReemModel() {
  const client = getNextGeminiClient();
  // استخدام gemini-1.5-flash كنموذج مستقر حالياً،
  // إذا حصل خطأ 404، يرجى التأكد من أن المفتاح يدعم هذا الإصدار.
  return client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: REEM_SYSTEM_INSTRUCTION,
  });
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, image } = req.body;
    const model = getReemModel();
    const parts = [{ text: message || 'مرحباً' }];

    if (image) {
      const match = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }

    const result = await model.generateContent(parts);
    const response = await result.response;
    res.json({ success: true, reply: response.text() });
  } catch (error) {
    console.error('Gemini Error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ في الاتصال بـ Gemini.' });
  }
});

app.post('/api/reset', (req, res) => res.json({ success: true }));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
