// ==============================================
// server.js
// السيرفر الخلفي لمساعد "ريم" (ReemApp Ultra) - Node.js + Express
// يعمل كطبقة وسيطة (Middleware) آمنة بين الواجهة الأمامية و Gemini API
// يدعم: المحادثة النصية، تحليل الصور (Multimodal)، توليد الصور (Pollinations)،
// وتدوير مفاتيح API (Key Rotation) لتفادي حدود الحصة المجانية.
// ==============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
// مكتبة multer لاستقبال ملفات الصور المرفوعة (multipart/form-data) في مسار تفريغ الخلفية
const multer = require('multer');
// مكتبة تفريغ خلفية الصور — تعمل محلياً بالكامل على السيرفر (نموذج ONNX)، مجانية
// وبلا حدود استخدام، ودون الحاجة لأي مفتاح API خارجي أو خدمة طرف ثالث كـ remove.bg
const { removeBackground } = require('@imgly/background-removal-node');

// ==============================================
// تحميل مفاتيح Gemini API (يدعم مفتاحاً واحداً أو عدة مفاتيح للتدوير)
// ==============================================
// الأولوية لـ GEMINI_API_KEYS (عدة مفاتيح مفصولة بفاصلة)، وإن لم يكن موجوداً
// نرجع تلقائياً لـ GEMINI_API_KEY القديم (مفتاح واحد) للحفاظ على التوافق العكسي.
//
// مثال في .env:
//   GEMINI_API_KEYS=AIzaSy...المفتاح_الأول,AIzaSy...المفتاح_الثاني,AIzaSy...المفتاح_الثالث
function loadApiKeys() {
  const multiKeysRaw = process.env.GEMINI_API_KEYS;
  const singleKeyRaw = process.env.GEMINI_API_KEY;

  if (multiKeysRaw && multiKeysRaw.trim()) {
    return multiKeysRaw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  if (singleKeyRaw && singleKeyRaw.trim()) {
    return [singleKeyRaw.trim()];
  }

  return [];
}

const API_KEYS = loadApiKeys();

// ---------- التحقق من وجود مفتاح API واحد على الأقل ----------
if (API_KEYS.length === 0) {
  console.error('❌ خطأ: لم يتم العثور على أي مفتاح Gemini في ملف .env');
  console.error('   أضيفي إما GEMINI_API_KEYS=مفتاح1,مفتاح2,مفتاح3 أو GEMINI_API_KEY=مفتاح_واحد');
  process.exit(1);
}

// تحذير غير مانع للتشغيل: مفاتيح Gemini القياسية تبدأ عادةً بـ "AIza"
API_KEYS.forEach((key, idx) => {
  if (!key.startsWith('AIza')) {
    console.warn(
      `⚠️ تنبيه: شكل المفتاح رقم ${idx + 1} غير مطابق للصيغة المعتادة لمفاتيح Gemini (عادة تبدأ بـ "AIza").`
    );
  }
});

console.log(
  API_KEYS.length > 1
    ? `🔑 تم تحميل ${API_KEYS.length} مفاتيح Gemini API — وضع تدوير المفاتيح (Round-Robin) مُفعّل ✅`
    : `🔑 تم تحميل مفتاح Gemini API واحد — وضع التدوير غير مُفعّل (طبيعي مع مفتاح واحد فقط)`
);

// ==============================================
// نظام تدوير المفاتيح (Round-Robin Key Rotation)
// ==============================================
// نُنشئ عميل GoogleGenerativeAI منفصلاً لكل مفتاح مرة واحدة عند الإقلاع (وليس مع كل طلب)
// لتفادي إعادة إنشاء الكائن بلا داعٍ، ثم نتنقل بينها بالتناوب مع كل طلب جديد.
const geminiClients = API_KEYS.map((key) => new GoogleGenerativeAI(key));

let currentKeyIndex = 0;

/**
 * يُعيد العميل (Client) التالي في دورة التناوب، ويُقدّم مؤشره أيضاً (للتسجيل/التصحيح).
 * مع مفتاح واحد فقط، تُعيد هذه الدالة نفس العميل دائماً بأمان تام (Fallback طبيعي).
 */
function getNextGeminiClient() {
  const keyIndex = currentKeyIndex;
  const client = geminiClients[keyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % geminiClients.length;
  return { client, keyIndex };
}

/** يُخفي أغلب المفتاح في السجلات، ويُبقي فقط بداية ونهاية قصيرتين للتمييز بين المفاتيح */
function maskKey(key) {
  if (!key || key.length <= 10) return '****';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// ---------- إعداد multer لاستقبال الصور المرفوعة (في الذاكرة مباشرة، بدون كتابتها على القرص) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 ميجابايت كحد أقصى لكل صورة
});

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- الميدل وير (Middlewares) ----------
app.use(cors());
// رفع الحد الأقصى لحجم الطلب لاستيعاب الصور المُرسلة كـ Base64
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // تقديم ملفات الواجهة الأمامية

// شخصية "ريم" - يتم إرسالها كـ systemInstruction لكل محادثة
// ملاحظة أمنية: هذا النص موجود في السيرفر فقط، ولا يصل للمستخدم مباشرة
// حتى لا يتم التلاعب به من الواجهة الأمامية
const REEM_SYSTEM_INSTRUCTION = `
أنتِ "ريم"، مساعدة ذكية، لطيفة، وودودة للغاية.
تُجيبين دائماً باللغة العربية الفصحى المبسطة، بأسلوب راقٍ وواضح ومباشر.
تستخدمين الإيموجي بشكل مناسب ومعتدل لإضفاء لمسة إنسانية دافئة على ردودك، دون مبالغة.
يمنع منعاً باتاً ذكر كلمة "Gemini" أو "Google" أو أي إشارة إلى الجهة التقنية التي بنتك، سواء بشكل مباشر أو غير مباشر.
اسمكِ دائماً وأبداً هو "ريم"، ولا يوجد اسم آخر لكِ مهما سُئلتِ.
إذا سألك أحد "من صنعك؟" أو ما شابه، أجيبي بأسلوب لطيف دون ذكر أي شركة تقنية، مثل: "أنا ريم، صُممت لأكون رفيقتك الذكية الودودة 😊".
حافظي على ردود مركزة وغير مطولة إلا إذا طلب المستخدم تفصيلاً أكبر.
عند تحليل صورة يرسلها المستخدم: صفي محتواها بدقة، اقرئي أي نص موجود فيها بالكامل، وإن كانت تحتوي على مسألة أو تمرين (رياضي أو علمي أو غيره) فقومي بحلّه خطوة بخطوة بأسلوب تعليمي واضح.
استخدمي تنسيق Markdown عند الحاجة (عناوين، قوائم نقطية، **نص عريض**، أكواد) لتنظيم الإجابات الطويلة أو الخطوات.
`.trim();

// ==============================================
// الوقت والتاريخ الحاليان — يُحقنان ديناميكياً مع كل طلب
// ==============================================
// المنطقة الزمنية الافتراضية للتطبيق (قابلة للتغيير عبر متغير بيئة TIMEZONE في .env)
const APP_TIMEZONE = process.env.TIMEZONE || 'Asia/Riyadh';

/**
 * يبني فقرة نصية تحتوي التاريخ والوقت الحاليين بدقة (ميلادي + هجري تقريبي + اليوم + الوقت)
 * بحسب المنطقة الزمنية المحددة، لتُضاف إلى تعليمات النظام مع كل طلب جديد.
 */
function getCurrentDateTimeContextAR() {
  const now = new Date();

  const gregorianFormatter = new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  let hijriLine = '';
  try {
    const hijriFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    hijriLine = `- التاريخ الهجري (تقريبي): ${hijriFormatter.format(now)}\n`;
  } catch (err) {
    // في حال عدم توفر تقويم هجري في بيئة التشغيل، نتجاهله بأمان دون كسر الطلب
    hijriLine = '';
  }

  return (
    `معلومات الوقت الحالي (حسب توقيت ${APP_TIMEZONE}):\n` +
    `- التاريخ الميلادي: ${gregorianFormatter.format(now)}\n` +
    hijriLine +
    `- الوقت الآن: ${timeFormatter.format(now)}\n` +
    `عندما يسألكِ المستخدم عن الوقت أو التاريخ أو اليوم الحالي، أجيبي فوراً وبثقة تامة بالاعتماد الحصري على المعلومات أعلاه، بأسلوب راقٍ وطبيعي (مثال: "الساعة الآن ٠٨:٣٤ صباحاً، واليوم هو الثلاثاء الموافق ٢١ يوليو ٢٠٢٦"). ممنوع منعاً باتاً القول إنكِ لا تملكين معرفة الوقت أو التاريخ الحاليين، فهذه المعلومات مؤكدة ومحدَّثة لحظياً.`
  );
}

/**
 * يبني تعليمات النظام الكاملة (شخصية ريم + الوقت/التاريخ الحاليان) طازجة مع كل طلب،
 * حتى تبقى "ريم" على اطلاع دائم باللحظة الحالية دون الحاجة لإعادة تشغيل السيرفر.
 */
function buildSystemInstruction() {
  return `${REEM_SYSTEM_INSTRUCTION}\n\n${getCurrentDateTimeContextAR()}`;
}

// ==============================================
// إعدادات الأمان (Safety Settings)
// ==============================================
// نُبقي فئتي "المحتوى الجنسي" و"المحتوى الخطير" على الحماية الافتراضية (لا نعطّلهما إطلاقاً)
// حماية للمستخدمين وللحساب، ونخفف فقط فئة "المضايقة" (Harassment) لمستوى أقل حساسية
// حتى لا تُحجب ردود بريئة بسبب أسلوب كلام عادي أو دعابة خفيفة.
const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

/**
 * يُنشئ نسخة من نموذج "ريم" مع تعليمات نظام محدَّثة بالوقت الحالي،
 * باستخدام العميل (Client) التالي في دورة تدوير المفاتيح.
 * إنشاء الكائن محلي بالكامل (بدون أي اتصال شبكة)، لذا استدعاؤه مع كل طلب غير مكلف.
 * gemini-3.5-flash يدعم الإدخال متعدد الوسائط (نص + صور) بشكل أصلي، وهو الجيل
 * الحالي المستقر (GA) والمتاح للمفاتيح الجديدة (توقفت جوجل عن منح مفاتيح جديدة
 * وصولاً لعائلتي Gemini 1.5 و Gemini 2.5 بالكامل، وأوقفت Gemini 2.0 في يونيو 2026).
 */
function getReemModel() {
  const { client, keyIndex } = getNextGeminiClient();
  if (API_KEYS.length > 1) {
    console.log(`🔁 [شات] استخدام المفتاح رقم ${keyIndex + 1}/${API_KEYS.length} (${maskKey(API_KEYS[keyIndex])})`);
  }
  return client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: buildSystemInstruction(),
    safetySettings: SAFETY_SETTINGS,
  });
}

/**
 * نموذج خفيف بدون شخصية، يُستخدم داخلياً فقط لتحسين طلبات توليد الصور (نصية أو رؤية/Vision).
 * يُبنى أيضاً من العميل التالي في دورة التدوير بدلاً من عميل ثابت واحد.
 */
function getPromptEnhancerModel() {
  const { client, keyIndex } = getNextGeminiClient();
  if (API_KEYS.length > 1) {
    console.log(`🔁 [تحسين وصف صورة] استخدام المفتاح رقم ${keyIndex + 1}/${API_KEYS.length} (${maskKey(API_KEYS[keyIndex])})`);
  }
  return client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    safetySettings: SAFETY_SETTINGS,
  });
}

// ---------- (اختياري) تخزين تاريخ المحادثة في الذاكرة لكل جلسة بسيطة ----------
// ملاحظة: هذا تخزين بسيط في الذاكرة (in-memory) لأغراض العرض التجريبي فقط
// في تطبيق إنتاجي حقيقي يُفضّل استخدام قاعدة بيانات أو تخزين مرتبط بجلسة المستخدم
let conversationHistory = [];

// ==============================================
// مهلة زمنية للطلب الواحد نحو الـ API (حماية من التعليق اللانهائي)
// ==============================================
const REQUEST_TIMEOUT_MS = 30000; // 30 ثانية (زيادة بسيطة لاستيعاب تحليل الصور)

function withTimeout(promise, ms) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error('REQUEST_TIMEOUT');
      err.code = 'REQUEST_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

// يكتشف أخطاء الضغط المؤقت على نموذج Gemini (503 / "high demand" / "overloaded")
// وهي مشكلة مؤقتة من جوجل عادة ما تُحل خلال ثوانٍ قليلة بإعادة المحاولة
function isOverloadedError(error) {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.response?.status;
  return (
    status === 503 ||
    message.includes('overloaded') ||
    message.includes('high demand') ||
    message.includes('service unavailable') ||
    message.includes('unavailable')
  );
}

// يكتشف أخطاء تجاوز الحصة/معدل الطلبات (429) الخاصة بمفتاح واحد بعينه —
// هذه هي الحالة التي يخدمها تدوير المفاتيح بشكل مباشر عبر تجربة مفتاح آخر
function isQuotaError(error) {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.response?.status;
  return status === 429 || message.includes('quota') || message.includes('resource_exhausted') || message.includes('rate limit');
}

// إعادة محاولة تلقائية محدودة (مرة واحدة افتراضياً) عند حدوث خطأ ضغط مؤقت (503) فقط،
// حتى لا تفشل المحادثة أو توليد الصورة لمجرد ضغط لحظي على خوادم جوجل
async function withRetry(taskFn, { retries = 1, delayMs = 1200 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await taskFn();
    } catch (error) {
      lastError = error;
      if (attempt < retries && isOverloadedError(error)) {
        console.warn(`⚠️ نموذج Gemini مشغول حالياً (503)، إعادة محاولة تلقائية (${attempt + 1}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * ينفذ دالة توليد (buildAndRunFn) وتُعيد المحاولة تلقائياً بمفتاح مختلف (عبر تدوير المفاتيح)
 * إن فشلت المحاولة بسبب تجاوز حصة (429) على المفتاح المستخدم، وذلك حتى استنفاد كل المفاتيح
 * المتاحة مرة واحدة لكل منها. مع مفتاح واحد فقط، تعمل كطلب عادي بدون إعادة محاولة إضافية.
 *
 * ملاحظة مهمة: يجب أن تقوم buildAndRunFn ببناء النموذج/الجلسة من جديد داخلها في كل استدعاء
 * (وليس مسبقاً خارجها)، لأن كل استدعاء لـ getReemModel()/getPromptEnhancerModel() يتقدّم
 * تلقائياً للمفتاح التالي في الدورة — وهذا هو ما يُحقق فعلياً "المحاولة بمفتاح آخر".
 */
async function withKeyRotationOnQuota(buildAndRunFn, label = 'طلب') {
  const attempts = Math.max(API_KEYS.length, 1);
  let lastError;

  for (let i = 0; i < attempts; i++) {
    try {
      return await buildAndRunFn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = i === attempts - 1;
      if (isQuotaError(error) && !isLastAttempt) {
        console.warn(
          `⚠️ تجاوز حصة الطلبات (429) لأحد المفاتيح أثناء [${label}]، إعادة المحاولة بمفتاح آخر (${i + 2}/${attempts})...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ==============================================
// تصنيف الأخطاء القادمة من Gemini API / الشبكة
// إلى رسائل عربية واضحة ومناسبة للمستخدم، مع كود حالة HTTP مناسب
// ==============================================
function classifyError(error) {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.response?.status;

  // 1) مفتاح API غير صالح أو مرفوض، أو بيانات اعتماد من نوع غير مدعوم أصلاً
  // (مثلاً نسخ توكن من نوع آخر بدلاً من مفتاح Gemini API الحقيقي الذي يبدأ بـ "AIza")
  if (
    (status === 400 && message.includes('api key')) ||
    message.includes('api_key_invalid') ||
    message.includes('api key not valid') ||
    message.includes('access_token_type_unsupported') ||
    message.includes('invalid authentication credentials') ||
    status === 403 ||
    message.includes('permission_denied')
  ) {
    return {
      httpStatus: 401,
      userMessage:
        'تعذّر التحقق من مفتاح الخدمة الخاص بالسيرفر 🔑 الرجاء التأكد من صحة المفاتيح في ملف .env وإعادة تشغيل السيرفر.',
      logPrefix: message.includes('access_token_type_unsupported')
        ? 'نوع بيانات الاعتماد غير مدعوم — هذا ليس مفتاح Gemini API حقيقياً (يجب أن يبدأ بـ "AIza"، احصلي عليه من aistudio.google.com/app/apikey)'
        : 'مفتاح API غير صالح',
    };
  }

  // 2) تجاوز الحصة المسموحة (Rate Limit / Quota) — بعد استنفاد كل المفاتيح المتاحة في التدوير
  if (isQuotaError(error)) {
    return {
      httpStatus: 429,
      userMessage:
        API_KEYS.length > 1
          ? 'تم الوصول للحد الأقصى من الطلبات على جميع المفاتيح المتاحة حالياً ⏳ الرجاء الانتظار قليلاً ثم المحاولة مجدداً.'
          : 'تم الوصول للحد الأقصى من الطلبات المسموح بها حالياً ⏳ الرجاء الانتظار قليلاً ثم المحاولة مجدداً (يمكنكِ إضافة أكثر من مفتاح عبر GEMINI_API_KEYS لتفادي هذا مستقبلاً).',
      logPrefix: 'تجاوز الحصة المسموحة على جميع المفاتيح (Quota/Rate limit)',
    };
  }

  // 3) نموذج غير موجود أو غير مدعوم (مثلاً بعد إيقاف جوجل لإصدار قديم من Gemini)
  if (status === 404 || message.includes('is not found for api version') || message.includes('not found for api')) {
    return {
      httpStatus: 500,
      userMessage:
        'اسم نموذج Gemini المستخدم في السيرفر لم يعد مدعوماً 🔧 الرجاء تحديث اسم النموذج في server.js إلى نموذج حالي متاح من جوجل.',
      logPrefix: 'نموذج Gemini غير موجود (404)',
    };
  }

  // 4) ضغط مؤقت على خوادم Gemini (503 High demand) - غالباً يُحل خلال ثوانٍ بإعادة المحاولة
  if (isOverloadedError(error)) {
    return {
      httpStatus: 503,
      userMessage:
        'نموذج الذكاء الاصطناعي يشهد ضغطاً مرتفعاً من جوجل حالياً 🌐 هذا أمر مؤقت عادة، الرجاء الانتظار لحظات ثم المحاولة مجدداً.',
      logPrefix: 'ضغط مؤقت على خوادم Gemini (503)',
    };
  }

  // 5) حظر بسبب سياسات الأمان/المحتوى (Safety Filters)
  if (message.includes('safety') || message.includes('blocked')) {
    return {
      httpStatus: 200, // ليست مشكلة تقنية، بل محتوى مرفوض؛ نُبقي الحالة 200 مع رسالة واضحة
      userMessage:
        'عذراً، لا يمكنني الرد على هذا الطلب لأنه يخالف معايير الاستخدام الآمن. هل يمكنك إعادة صياغته؟ 🌸',
      logPrefix: 'حظر بواسطة فلاتر الأمان (Safety)',
    };
  }

  // 6) مهلة الطلب انتهت
  if (error?.code === 'REQUEST_TIMEOUT') {
    return {
      httpStatus: 504,
      userMessage: 'استغرقت العملية وقتاً أطول من المتوقع ⏱️ الرجاء المحاولة مرة أخرى.',
      logPrefix: 'انتهت مهلة الطلب (Timeout)',
    };
  }

  // 7) مشاكل الاتصال بالإنترنت / تعذر الوصول للخادم الخارجي
  if (
    ['enotfound', 'econnrefused', 'econnreset', 'eai_again', 'fetch failed', 'network'].some((k) =>
      message.includes(k)
    )
  ) {
    return {
      httpStatus: 503,
      userMessage:
        'تعذّر الوصول إلى خدمة الذكاء الاصطناعي حالياً 🌐 الرجاء التأكد من اتصال السيرفر بالإنترنت والمحاولة مجدداً.',
      logPrefix: 'خطأ في الاتصال بالشبكة',
    };
  }

  // 8) أي خطأ غير متوقع آخر
  return {
    httpStatus: 500,
    userMessage: 'عذراً، حدث خطأ أثناء معالجة طلبك. الرجاء المحاولة مرة أخرى بعد قليل.',
    logPrefix: 'خطأ غير متوقع',
  };
}

// ==============================================
// أدوات مساعدة للصور (Multimodal)
// ==============================================

// أنواع الصور المسموح بها لحماية السيرفر من ملفات غير متوقعة
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * يفكك صورة بصيغة Data URL (data:image/png;base64,....) إلى
 * { mimeType, base64Data } جاهزة للإرسال إلى Gemini كـ inlineData
 */
function parseDataUrlImage(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, base64Data] = match;
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) return null;
  return { mimeType, base64Data };
}

// ==============================================
// كشف طلبات "الرسم/توليد الصور" على مستوى السيرفر (خط دفاع ثانٍ)
// يطابق نفس الأنماط المستخدمة في الواجهة الأمامية (script.js)؛ حتى لو فات هذا الطلب
// الفحصَ في المتصفح لأي سبب، لا نُمرره لـ Gemini كمحادثة عادية (تجنباً لرفضه)،
// بل نوجّهه فوراً لمسار توليد الصور نفسه.
// ==============================================
const IMAGE_GENERATION_PATTERNS = [
  /^\/(رسم|صورة|image|draw)\b/i,
  /ارسم(?:ي)?/,
  /ارسمل(?:ي)?/,
  /اعمل(?:ي)?\s*(لي|لى)?\s*صورة/,
  /صمم(?:ي)?\s*(لي|لى)?\s*صورة/,
  /(ولّد|ولد|انشئ|أنشئ|اصنع|كوّن|كون)\s*(لي|لى)?\s*صورة/,
  /صورة\s*(لـ|ل|عن|بعنوان)/,
  /تخيل(?:ي)?\s*صورة/,
  /عدّ?ل(?:ي)?/,
  /غيّ?ر(?:ي)?\s*(اللون|لون|الخلفية|الشكل)/,
  /بدّ?ل(?:ي)?\s*(اللون|لون|الخلفية)/,
  /حوّ?ل(?:ي)?\s*(هذه\s*)?الصورة/,
  /generate\s+(an?\s+)?image/i,
  /draw\s+(me\s+)?(a|an)?\s*/i,
  /create\s+(an?\s+)?image/i,
  /make\s+(me\s+)?(an?\s+)?(image|picture|drawing)/i,
  /edit\s+(this|the)?\s*image/i,
  /change\s+the\s+(color|background)/i,
];

function isImageGenerationRequest(text) {
  if (!text) return false;
  return IMAGE_GENERATION_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

// ==============================================
// المنطق الفعلي لتوليد صورة (مُستخدَم من /api/generate-image ومن /api/chat كخط دفاع ثانٍ)
// ==============================================
async function generateImageInternal({ prompt, image }) {
  let parsedImage = null;
  if (typeof image === 'string' && image.length > 0) {
    parsedImage = parseDataUrlImage(image);
    if (!parsedImage) {
      return {
        success: false,
        error: 'صيغة الصورة المرفقة غير مدعومة. الصيغ المسموحة: JPG, PNG, WEBP.',
      };
    }
  }

  let enhancedPrompt = prompt.trim();
  let enhancementSucceeded = false;

  try {
    let enhanceResult;

    if (parsedImage) {
      const visionEnhanceInstruction =
        'You will receive an image and a requested edit/modification, written in Arabic or English. ' +
        'Carefully examine the image (subject, setting, colors, lighting, style, composition), then ' +
        'translate the requested modification and rewrite everything as ONE single, rich, highly detailed ' +
        'English prompt for an AI image generator. The prompt must describe: the main subject, the scene/' +
        'background, lighting and mood, color palette, and art style — recreating a similar image with the ' +
        'requested modification clearly applied. Write 2-4 descriptive sentences, not just a few words. ' +
        'Append these quality keywords at the end: highly detailed, 4k resolution, cinematic lighting, digital art, masterpiece. ' +
        'Only output the final English prompt itself, with no quotes, labels, translations, or extra commentary.\n\n' +
        `User's requested modification (may be in Arabic): ${prompt.trim()}`;

      enhanceResult = await withKeyRotationOnQuota(
        () =>
          withRetry(() =>
            withTimeout(
              getPromptEnhancerModel().generateContent([
                { inlineData: { mimeType: parsedImage.mimeType, data: parsedImage.base64Data } },
                { text: visionEnhanceInstruction },
              ]),
              15000
            )
          ),
        'تحسين وصف صورة (Vision)'
      );
    } else {
      const enhanceInstruction =
        'Translate and rewrite the following image request (written in Arabic or English) as ONE single, ' +
        'rich, highly detailed English prompt suitable for an AI image generator. Expand it with specific ' +
        'visual details: the main subject and its appearance, the setting/background, lighting and mood, ' +
        'color palette, and an appropriate art style (e.g. photorealistic, digital art, watercolor) if none ' +
        'is specified. Write 2-4 descriptive sentences, not just a few words. ' +
        'Append these quality keywords at the end: highly detailed, 4k resolution, cinematic lighting, digital art, masterpiece. ' +
        'Only output the final English prompt itself, with no quotes, labels, translations, or extra text:\n\n' +
        `Original request: ${prompt.trim()}`;

      enhanceResult = await withKeyRotationOnQuota(
        () => withRetry(() => withTimeout(getPromptEnhancerModel().generateContent(enhanceInstruction), 12000)),
        'تحسين وصف صورة (نص)'
      );
    }

    const enhancedText = enhanceResult.response.text().trim();
    if (enhancedText) {
      enhancedPrompt = enhancedText.replace(/^["']|["']$/g, '');
      enhancementSucceeded = true;
    }
  } catch (enhanceError) {
    console.warn('⚠️ تعذّر تحسين وصف الصورة عبر Gemini، سيتم استخدام الوصف الأصلي كما هو:', enhanceError.message);
  }

  const seed = Math.floor(Math.random() * 1_000_000);
  const imageUrl =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}` +
    `?width=1024&height=1024&nologo=true&seed=${seed}`;

  console.log(
    enhancementSucceeded
      ? `🎨 تم تحسين الوصف عبر Gemini: "${enhancedPrompt}"`
      : `🎨 تعذّر التحسين، استُخدم الوصف الأصلي كما هو: "${enhancedPrompt}"`
  );

  return {
    success: true,
    imageUrl,
    promptUsed: enhancedPrompt,
    enhanced: enhancementSucceeded,
    basedOnOriginalImage: !!parsedImage,
  };
}

// ---------- Endpoint الرئيسي: /api/chat ----------
// يدعم الآن: { message: string, image?: dataURL }
app.post('/api/chat', async (req, res) => {
  try {
    const { message, image } = req.body;

    const hasText = typeof message === 'string' && message.trim().length > 0;
    const hasImage = typeof image === 'string' && image.length > 0;

    if (!hasText && !hasImage) {
      return res.status(400).json({
        success: false,
        error: 'الرجاء إرسال رسالة نصية أو صورة صحيحة.',
      });
    }

    // خط دفاع ثانٍ: إن كان الطلب صريحاً بالرسم (ولم تُرفق صورة أصلية للتحليل)، نوجّهه فوراً
    // لمسار توليد الصور بدلاً من تمريره لـ Gemini كمحادثة نصية عادية (تجنباً لرفضه للطلب).
    if (hasText && !hasImage && isImageGenerationRequest(message)) {
      const genResult = await generateImageInternal({ prompt: message });
      return res.json({ ...genResult, type: 'image' });
    }

    if (hasText && message.length > 4000) {
      return res.status(400).json({
        success: false,
        error: 'الرسالة طويلة جداً، الرجاء اختصارها والمحاولة مجدداً.',
      });
    }

    // بناء أجزاء الرسالة (Parts) - نص و/أو صورة
    const parts = [];
    let parsedImage = null;

    if (hasImage) {
      parsedImage = parseDataUrlImage(image);
      if (!parsedImage) {
        return res.status(400).json({
          success: false,
          error: 'صيغة الصورة غير مدعومة. الصيغ المسموحة: JPG, PNG, WEBP.',
        });
      }
      parts.push({
        inlineData: { mimeType: parsedImage.mimeType, data: parsedImage.base64Data },
      });
    }

    // نص افتراضي مناسب إن أرسل المستخدم صورة بدون تعليق
    const textForModel = hasText ? message : 'حللي هذه الصورة، اقرئي ما فيها من نصوص، وإن كانت تحتوي على سؤال أو تمرين فقومي بحله خطوة بخطوة.';
    parts.push({ text: textForModel });

    // إرسال رسالة المستخدم واستقبال الرد:
    // - كل محاولة تبني جلسة محادثة جديدة من getReemModel() (يتقدّم تلقائياً للمفتاح التالي في التدوير)
    // - withRetry: يعيد المحاولة بنفس المفتاح عند ضغط مؤقت (503)
    // - withKeyRotationOnQuota: يعيد المحاولة بمفتاح آخر بالكامل عند تجاوز الحصة (429)
    const result = await withKeyRotationOnQuota(
      () =>
        withRetry(() => {
          const chat = getReemModel().startChat({
            history: conversationHistory,
            generationConfig: {
              maxOutputTokens: 1200,
              temperature: 0.8,
            },
          });
          return withTimeout(chat.sendMessage(parts), REQUEST_TIMEOUT_MS);
        }),
      'محادثة رئيسية'
    );

    const responseText = result.response.text();

    // في حال رجع النص فارغاً (مثلاً بسبب حظر جزئي) نتعامل معه كحالة خاصة
    if (!responseText || !responseText.trim()) {
      return res.json({
        success: true,
        reply: 'عذراً، لم أتمكن من صياغة رد مناسب على ذلك. هل يمكنك إعادة صياغة سؤالك؟ 🌸',
      });
    }

    // تحديث تاريخ المحادثة (نخزن نص المستخدم فقط في التاريخ لتفادي تضخم الذاكرة بالصور)
    conversationHistory.push(
      { role: 'user', parts: [{ text: hasText ? message : '[أرسل المستخدم صورة]' }] },
      { role: 'model', parts: [{ text: responseText }] }
    );

    // للحفاظ على أداء جيد، نحافظ على آخر 20 رسالة فقط في الذاكرة
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }

    return res.json({
      success: true,
      reply: responseText,
    });
  } catch (error) {
    const { httpStatus, userMessage, logPrefix } = classifyError(error);
    console.error(`❌ ${logPrefix}:`, error.message);
    return res.status(httpStatus).json({
      success: false,
      error: userMessage,
    });
  }
});

// ---------- Endpoint توليد الصور: /api/generate-image ----------
// يستخدم Pollinations.ai (مجاني وبدون مفتاح) لتوليد الصورة فعلياً،
// مع تمرير الطلب أولاً على نموذج نصي خفيف لتحويله إلى وصف إنجليزي
// دقيق يعطي نتائج أفضل بكثير من الطلب العربي الخام.
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, image } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'الرجاء وصف الصورة المطلوبة أولاً.' });
    }
    if (prompt.length > 800) {
      return res.status(400).json({ success: false, error: 'وصف الصورة طويل جداً، الرجاء اختصاره.' });
    }

    const genResult = await generateImageInternal({ prompt, image });
    if (!genResult.success) {
      return res.status(400).json(genResult);
    }
    return res.json(genResult);
  } catch (error) {
    const { httpStatus, userMessage, logPrefix } = classifyError(error);
    console.error(`❌ ${logPrefix}:`, error.message);
    return res.status(httpStatus).json({ success: false, error: userMessage });
  }
});

// ---------- Endpoint تفريغ خلفية الصورة: /api/remove-bg ----------
// يستقبل صورة كملف مرفوع (multipart/form-data عبر multer، الحقل يجب أن يكون اسمه "image")،
// ويُعيدها بعد إزالة خلفيتها بالكامل (خلفية شفافة) كصورة PNG بصيغة Data URL جاهزة للعرض/التحميل.
// المعالجة تتم محلياً بالكامل على السيرفر عبر @imgly/background-removal-node (نموذج ONNX)
// — مجانية بلا حدود استخدام، ولا تحتاج لأي مفتاح API خارجي أو رفع الصورة لأي خدمة طرف ثالث.
// ملاحظة: هذا المسار لا يستخدم Gemini إطلاقاً، لذا لا علاقة له بتدوير المفاتيح.
app.post(
  '/api/remove-bg',
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'حجم الصورة كبير جداً (الحد الأقصى 8 ميجابايت).'
            : 'تعذّر استقبال الصورة المرسلة.';
        return res.status(400).json({ success: false, error: message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'الرجاء إرسال صورة صحيحة لتفريغ خلفيتها.',
        });
      }

      if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: 'صيغة الصورة غير مدعومة. الصيغ المسموحة: JPG, PNG, WEBP.',
        });
      }

      const inputBlob = new Blob([req.file.buffer], { type: req.file.mimetype });

      // مهلة أطول من بقية الطلبات (60 ثانية) لاستيعاب تحميل نموذج ONNX عند أول تشغيل للسيرفر فقط
      const resultBlob = await withTimeout(removeBackground(inputBlob), 60000);
      const resultArrayBuffer = await resultBlob.arrayBuffer();
      const resultBase64 = Buffer.from(resultArrayBuffer).toString('base64');

      return res.json({
        success: true,
        imageUrl: `data:image/png;base64,${resultBase64}`,
      });
    } catch (error) {
      const isTimeout = error?.code === 'REQUEST_TIMEOUT';
      console.error('❌ خطأ أثناء تفريغ خلفية الصورة:', error.message);
      return res.status(isTimeout ? 504 : 500).json({
        success: false,
        error: isTimeout
          ? 'استغرقت عملية تفريغ الخلفية وقتاً أطول من المتوقع ⏱️ الرجاء المحاولة مرة أخرى.'
          : 'تعذّر تفريغ خلفية الصورة، الرجاء المحاولة مرة أخرى لاحقاً.',
      });
    }
  }
);

// ---------- Endpoint لتصفير المحادثة (اختياري ومفيد للواجهة) ----------
app.post('/api/reset', (req, res) => {
  conversationHistory = [];
  return res.json({ success: true, message: 'تم تصفير المحادثة بنجاح.' });
});

// ---------- معالجة الأخطاء العامة (Fallback) ----------
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'المسار المطلوب غير موجود.' });
});

// ---------- تشغيل السيرفر ----------
app.listen(PORT, () => {
  console.log(`✅ سيرفر "ريم" (Ultra) يعمل الآن على: http://localhost:${PORT}`);
});