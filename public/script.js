// ==============================================
// script.js - منطق واجهة "ريم" (ReemApp Ultra)
// دردشة نصية/صور، توليد صور، مكالمة صوتية مباشرة، Markdown، نسخ/إعادة توليد،
// شريط جانبي بسجل المحادثات، وضع داكن/فاتح، اختيار صوت، تحميل الصور، وكاش محلي
// ==============================================

// ==============================================
// 🔧 إعدادات تطبيق الهاتف (Capacitor) — هذا الجزء فقط يُعدَّل عند تحويل التطبيق لأندرويد
// ==============================================
// ⚠️ بعد رفع السيرفر (server.js) على استضافة مجانية (مثل Render.com)، ضع رابطه هنا
// بدون شرطة "/" في النهاية. اتركه فارغاً '' أثناء التطوير العادي في المتصفح أو كـ PWA.
const PRODUCTION_SERVER_URL = 'https://reemappbg.onrender.com';

// كشف تلقائي: هل يعمل التطبيق الآن داخل تطبيق أندرويد حقيقي مبني بـ Capacitor؟
const IS_NATIVE_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// دالة آمنة لإيقاف النطق
function safeCancelSpeech() {
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
}

// دالة للملاحظات اللمسية (Vibration) لإضفاء لمسة احترافية
async function triggerHaptic(type = 'light') {
  if (!IS_NATIVE_APP || !window.Capacitor || !window.Capacitor.Plugins.Haptics) return;
  try {
    const Haptics = window.Capacitor.Plugins.Haptics;
    if (type === 'impact') await Haptics.impact({ style: 'MEDIUM' });
    else if (type === 'notification') await Haptics.notification({ type: 'SUCCESS' });
    else await Haptics.selectionStart();
  } catch (e) {}
}

// ==============================================
// 🔐 طلب كل أذونات الجهاز الحساسة فور فتح التطبيق (Runtime Permissions)
// يعمل فقط داخل تطبيق أندرويد الحقيقي (APK)، وليس له أي تأثير في المتصفح/PWA.
// يتطلب تثبيت ومزامنة الإضافتين: @capacitor/camera و @capgo/capacitor-speech-recognition
// (راجع تعليمات npm install + npx cap sync android في تذييل الملف/الرسالة).
// ==============================================
async function primeNativePermissions() {
  if (!IS_NATIVE_APP || !window.Capacitor || !window.Capacitor.Plugins) return;

  // 1) إذن الكاميرا + المعرض/الصور
  try {
    const CameraPlugin = window.Capacitor.Plugins.Camera;
    if (CameraPlugin && CameraPlugin.requestPermissions) {
      await CameraPlugin.requestPermissions({ permissions: ['camera', 'photos'] });
    } else {
      console.warn('إضافة @capacitor/camera غير مثبّتة/مُزامَنة — لن يظهر طلب إذن الكاميرا.');
    }
  } catch (err) {
    console.warn('تعذّر طلب إذن الكاميرا:', err);
  }

  // 2) إذن المايكروفون (عبر إضافة التعرف الصوتي الأصلية)
  try {
    const SpeechPlugin = window.Capacitor.Plugins.SpeechRecognition;
    if (SpeechPlugin && SpeechPlugin.requestPermissions) {
      await SpeechPlugin.requestPermissions();
    } else {
      console.warn('إضافة التعرف الصوتي غير مثبّتة/مُزامَنة — لن يظهر طلب إذن المايكروفون.');
    }
  } catch (err) {
    console.warn('تعذّر طلب إذن المايكروفون:', err);
  }
}

// ==============================================
// 14) الشاشة الافتتاحية (Splash Screen) + التهيئة الأولية
// ==============================================
function initApp() {
  refreshIcons();
  getOrCreateActiveConversation();
  loadActiveConversationIntoChatWindow();
  renderConversationList();
  primeNativePermissions();
  wakeupServer();

  if (userInput) userInput.focus();
  updateInputActionsVisibility();

  // إخفاء الـ Splash Screen بأمان
  setTimeout(() => {
    if (splashScreen) {
      splashScreen.classList.add('splash-hidden');
      setTimeout(() => splashScreen.remove(), 600);
    }
  }, 500);
}

// التشغيل المباشر عند جاهزية العناصر دون انتظار تحميل الكاش بالكامل
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
// كل نداءات الشبكة نحو /api/... تمرّ عبر هذا الأساس، حتى تعمل تلقائياً محلياً
// (نفس المضيف) في المتصفح، ونحو السيرفر الخارجي عند التشغيل كتطبيق أندرويد.
const API_BASE_URL = IS_NATIVE_APP ? PRODUCTION_SERVER_URL : '';

async function wakeupServer() {
  try {
    await fetch(`${API_BASE_URL}/api/reset`, { method: 'POST' });
  } catch (err) {
    console.warn('السيرفر قد يكون نائماً.');
  }
}

// ---------- عناصر الصفحة ----------
const chatWindow = document.getElementById('chatWindow');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sendIcon = document.getElementById('sendIcon');
const micBtn = document.getElementById('micBtn');
const muteBtn = document.getElementById('muteBtn');
const muteIcon = document.getElementById('muteIcon');
const resetBtn = document.getElementById('resetBtn');
const typingIndicator = document.getElementById('typingIndicator');
const typingText = document.getElementById('typingText');
const splashScreen = document.getElementById('splashScreen');
const connectionBanner = document.getElementById('connectionBanner');
const connectionBannerText = document.getElementById('connectionBannerText');
const voiceSelect = document.getElementById('voiceSelect');

const imageInput = document.getElementById('imageInput');
const cameraInput = document.getElementById('cameraInput');
const fileInput = document.getElementById('fileInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
const imagePreviewImg = document.getElementById('imagePreviewImg');
const removeImageBtn = document.getElementById('removeImageBtn');

const addBtn = document.getElementById('addBtn');
const waveBtn = document.getElementById('waveBtn');
const addSheetOverlay = document.getElementById('addSheetOverlay');
const addSheet = document.getElementById('addSheet');
const sheetImagesBtn = document.getElementById('sheetImagesBtn');
const sheetCameraBtn = document.getElementById('sheetCameraBtn');
const sheetFilesBtn = document.getElementById('sheetFilesBtn');
const sheetGenerateBtn = document.getElementById('sheetGenerateBtn');

const callBtn = document.getElementById('callBtn');
const callOverlay = document.getElementById('callOverlay');
const callStatus = document.getElementById('callStatus');
const callWave = document.getElementById('callWave');
const callMicToggleBtn = document.getElementById('callMicToggleBtn');
const endCallBtn = document.getElementById('endCallBtn');
const callRetryBtn = document.getElementById('callRetryBtn');

const menuBtn = document.getElementById('menuBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const newChatBtn = document.getElementById('newChatBtn');
const conversationList = document.getElementById('conversationList');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeToggleLabel = document.getElementById('themeToggleLabel');
const clearAllBtn = document.getElementById('clearAllBtn');

// ---------- الحالة العامة ----------
let autoSpeak = false;      // هل تُقرأ الردود صوتياً تلقائياً في الشات العادي؟ (افتراضياً: لا)
let isSending = false;      // منع إرسال أكثر من رسالة في نفس الوقت
let pendingImage = null;    // { dataUrl } للصورة المرفقة قبل الإرسال
let lastUserMessage = null; // لإعادة توليد آخر رد
let lastUserImage = null;
let currentAbortController = null; // للتحكم بإيقاف طلب الشبكة الجاري

// ---------- مفاتيح التخزين المحلي ----------
const LS_KEYS = {
  conversations: 'reem_conversations_v1',
  activeConversation: 'reem_active_conversation_v1',
  imageCache: 'reem_image_cache_v1',
  voice: 'reem_voice_uri_v1',
  theme: 'reem_theme',
};

const WELCOME_TEXT = 'أهلاً بك! أنا ريم، مساعدتك الذكية 🌸 يمكنني الآن فهم الصور وحل المسائل منها، والدردشة معك بأسلوب طبيعي، ورسم ما تتخيلينه أيضاً 🎨✨ كيف يمكنني مساعدتك اليوم؟';

// كلمات مفتاحية تدل على طلب توليد/رسم صورة
const IMAGE_GENERATION_PATTERNS = [
  /^\/(رسم|صورة|image|draw)\b/i,
  /ارسم(?:ي)?/,
  /ارسمل(?:ي)?/,
  /اعمل(?:ي)?\s*(لي|لى)?\s*صورة/,
  /صمم(?:ي)?\s*(لي|لى)?\s*صورة/,
  /(ولّد|ولد|انشئ|أنشئ|اصنع|كوّن|كون)\s*(لي|لى)?\s*صورة/,
  /صورة\s*(لـ|ل|عن|بعنوان)/,
  /تخيل(?:ي)?\s*صورة/,
  // طلبات تعديل/تغيير على صورة (لا يمكن تعديل البكسلات مباشرة، لذا تُعامَل كإعادة توليد)
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
// كشف نية "تفريغ/تعديل الخلفية" — يُستخدم فقط عندما تكون هناك صورة مرفقة مع النص.
// له أولوية على أنماط توليد الصور العامة أعلاه، لأن تفريغ الخلفية عملية حقيقية
// تُنفَّذ على بكسلات الصورة الأصلية (عبر /api/remove-bg) وليست إعادة توليد بالذكاء الاصطناعي.
// ==============================================
const BG_REMOVAL_PATTERNS = [
  /(احذف|احذفي|امسح|امسحي|شيل|شيلي|از[إا]ل[هة]?|از[إا]لي)\s*(لي|لى)?\s*(ال)?خلفي[ةه]/,
  /فر[غّ]{1,2}[يّ]?\s*(لي|لى)?\s*(ال)?(صور[ةه]|خلفي[ةه])/,
  /قص(?:ي)?\s*(ال)?خلفي[ةه]/,
  /خلفي[ةه]\s*(شفاف[ةه]|بيضاء|فارغ[ةه])/,
  /(بدون|بلا|من\s*غير)\s*خلفي[ةه]/,
  /عدّ?ل(?:ي)?\s*(لي|لى)?\s*(هذه\s*)?(ال)?صور[ةه]/,
  /remove\s+(the\s+)?background/i,
  /(no|without)\s+background/i,
  /transparent\s+background/i,
  /erase\s+(the\s+)?background/i,
  /cut\s*out\s+(the\s+)?background/i,
  /background\s+removal/i,
];

function isBgRemovalRequest(text) {
  if (!text) return false;
  return BG_REMOVAL_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

// يحوّل صورة بصيغة Data URL (كتلك المخزّنة في pendingImage) إلى Blob حقيقي،
// جاهز للإرفاق داخل FormData عند إرسال ملفات عبر multer إلى السيرفر.
function dataUrlToBlob(dataUrl) {
  const [header, base64Data] = dataUrl.split(',');
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function extractImagePrompt(text) {
  // إزالة أوامر السلاش إن وجدت، وإلا نُعيد النص كما هو (يفهمه الموديل المُحسِّن في السيرفر)
  return text.replace(/^\/(رسم|صورة|image|draw)\s*/i, '').trim() || text.trim();
}

// ==============================================
// 0) تهيئة الأيقونات (Lucide) — تُستدعى بعد أي إضافة أيقونات ديناميكية
// ==============================================
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// ==============================================
// 1) عرض Markdown بأمان (marked + DOMPurify) + أزرار نسخ الأكواد
// ==============================================
if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
}

function renderMarkdownSafely(rawText) {
  try {
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(rawText);
      return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    }
  } catch (err) {
    console.warn('تعذّر تنسيق Markdown، سيتم عرض النص كما هو:', err);
  }
  // fallback: نص عادي مع الحفاظ على الأسطر
  const div = document.createElement('div');
  div.textContent = rawText;
  return div.innerHTML.replace(/\n/g, '<br>');
}

// يضيف زر "نسخ الكود" فوق كل مربع كود (<pre>) داخل عنصر النص المُعطى
function attachCodeCopyButtons(container) {
  const preBlocks = container.querySelectorAll('pre');
  preBlocks.forEach((pre) => {
    if (pre.parentElement.classList.contains('code-block-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'code-block-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.type = 'button';
    copyBtn.innerHTML = '<i data-lucide="copy"></i><span>نسخ</span>';
    copyBtn.addEventListener('click', () => {
      const codeText = pre.innerText;
      navigator.clipboard.writeText(codeText).then(() => {
        copyBtn.innerHTML = '<i data-lucide="check"></i><span>تم!</span>';
        refreshIcons();
        setTimeout(() => {
          copyBtn.innerHTML = '<i data-lucide="copy"></i><span>نسخ</span>';
          refreshIcons();
        }, 1300);
      }).catch(() => {
        console.warn('تعذّر نسخ الكود.');
      });
    });
    wrap.appendChild(copyBtn);
  });
}

// ==============================================
// 2) إضافة رسالة إلى نافذة المحادثة
// ==============================================
function appendMessage(options) {
  const {
    text = '',
    sender = 'bot',
    isError = false,
    imageDataUrl = null,      // صورة أرفقها المستخدم
    generatedImageUrl = null, // صورة ولّدتها ريم
    isMarkdown = true,
    withActions = false,      // نسخ/إعادة توليد/نطق (للردود النصية من ريم فقط)
    persist = true,           // هل تُحفظ هذه الرسالة في سجل المحادثة المحلي؟
  } = options;

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'bot-message'} ${isError ? 'error-message' : ''}`;

  const avatarHtml = sender === 'bot'
    ? `<div class="message-avatar"><img src="icons/icon-192.png" alt="ريم" /></div>`
    : '';

  const contentWrap = document.createElement('div');
  contentWrap.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (imageDataUrl) {
    const img = document.createElement('img');
    img.src = imageDataUrl;
    img.className = 'message-image';
    img.alt = 'صورة مرفقة';
    bubble.appendChild(img);
  }

  if (generatedImageUrl) {
    const wrap = document.createElement('div');
    wrap.className = 'generated-image-wrap';
    const img = document.createElement('img');
    img.src = generatedImageUrl;
    img.className = 'message-image generated-image';
    img.alt = 'صورة تم توليدها';
    img.loading = 'lazy';
    wrap.appendChild(img);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-image-btn';
    downloadBtn.type = 'button';
    downloadBtn.innerHTML = '<i data-lucide="download"></i><span>تحميل الصورة</span>';
    downloadBtn.addEventListener('click', () => downloadGeneratedImage(generatedImageUrl, downloadBtn));
    wrap.appendChild(downloadBtn);

    bubble.appendChild(wrap);
  }

  if (text && text.trim()) {
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    if (sender === 'bot' && isMarkdown && !isError) {
      textDiv.innerHTML = renderMarkdownSafely(text);
      attachCodeCopyButtons(textDiv);
    } else {
      textDiv.textContent = text;
    }
    bubble.appendChild(textDiv);
  }

  contentWrap.appendChild(bubble);

  if (withActions && sender === 'bot' && !isError) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // إعجاب / عدم إعجاب (تقييم سريع للرد)
    const thumbsUpBtn = document.createElement('button');
    thumbsUpBtn.className = 'msg-action-btn thumbs-up';
    thumbsUpBtn.title = 'إعجاب';
    thumbsUpBtn.innerHTML = '<i data-lucide="thumbs-up"></i>';

    const thumbsDownBtn = document.createElement('button');
    thumbsDownBtn.className = 'msg-action-btn thumbs-down';
    thumbsDownBtn.title = 'عدم إعجاب';
    thumbsDownBtn.innerHTML = '<i data-lucide="thumbs-down"></i>';

    thumbsUpBtn.addEventListener('click', () => {
      const isActive = thumbsUpBtn.classList.toggle('active');
      thumbsDownBtn.classList.remove('active');
      if (isActive) thumbsUpBtn.title = 'تم الإعجاب';
      else thumbsUpBtn.title = 'إعجاب';
      thumbsDownBtn.title = 'عدم إعجاب';
    });

    thumbsDownBtn.addEventListener('click', () => {
      const isActive = thumbsDownBtn.classList.toggle('active');
      thumbsUpBtn.classList.remove('active');
      if (isActive) thumbsDownBtn.title = 'تم تسجيل عدم الإعجاب';
      else thumbsDownBtn.title = 'عدم إعجاب';
      thumbsUpBtn.title = 'إعجاب';
    });

    // إعادة توليد الرد
    const regenBtn = document.createElement('button');
    regenBtn.className = 'msg-action-btn';
    regenBtn.title = 'إعادة توليد الرد';
    regenBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';
    regenBtn.addEventListener('click', () => regenerateLastResponse(messageDiv));

    // نسخ النص
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'نسخ الرد';
    copyBtn.innerHTML = '<i data-lucide="copy"></i>';
    copyBtn.addEventListener('click', () => copyToClipboard(text, copyBtn));

    // زر نطق/إيقاف الصوت (يعمل كمفتاح تبديل واحد)
    const speakBtn = document.createElement('button');
    speakBtn.className = 'msg-action-btn';
    speakBtn.title = 'نطق الرد';
    speakBtn.innerHTML = '<i data-lucide="volume-2"></i>';
    speakBtn.addEventListener('click', () => {
      triggerHaptic('selection');
      if (speakBtn.dataset.speaking === 'true') {
        safeCancelSpeech();
        speakBtn.dataset.speaking = 'false';
        speakBtn.innerHTML = '<i data-lucide="volume-2"></i>';
        speakBtn.title = 'نطق الرد';
        refreshIcons();
        return;
      }
      speak(text, () => {
        speakBtn.dataset.speaking = 'false';
        speakBtn.innerHTML = '<i data-lucide="volume-2"></i>';
        speakBtn.title = 'نطق الرد';
        refreshIcons();
      });
      speakBtn.dataset.speaking = 'true';
      speakBtn.innerHTML = '<i data-lucide="volume-x"></i>';
      speakBtn.title = 'إيقاف الصوت';
      refreshIcons();
    });

    actions.appendChild(thumbsUpBtn);
    actions.appendChild(thumbsDownBtn);
    actions.appendChild(regenBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(speakBtn);
    contentWrap.appendChild(actions);
  }

  messageDiv.innerHTML = avatarHtml;
  messageDiv.appendChild(contentWrap);

  chatWindow.appendChild(messageDiv);
  refreshIcons();
  scrollToBottom();

  if (persist) {
    saveMessageToActiveConversation({ text, sender, isError, imageDataUrl, generatedImageUrl, isMarkdown, withActions });
  }

  return messageDiv;
}

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="check"></i>';
    refreshIcons();
    setTimeout(() => { btn.innerHTML = original; refreshIcons(); }, 1200);
  }).catch(() => {
    console.warn('تعذّر النسخ إلى الحافظة.');
  });
}

// تحميل صورة مولّدة كملف على جهاز المستخدم (تُجلب كـ blob لضمان عمل التحميل عبر النطاقات)
async function downloadGeneratedImage(imageUrl, btn) {
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader-circle"></i><span>جاري التحميل...</span>';
  refreshIcons();
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `reem-image-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch (err) {
    console.warn('تعذّر تحميل الصورة مباشرة، سيتم فتحها في نافذة جديدة:', err);
    window.open(imageUrl, '_blank');
  } finally {
    btn.innerHTML = originalHtml;
    refreshIcons();
  }
}

async function regenerateLastResponse(messageDivToReplace) {
  if (!lastUserMessage && !lastUserImage) return;
  if (isSending) return;

  removeLastMessageFromActiveConversation();
  messageDivToReplace.remove();
  await performSend({ message: lastUserMessage, imageDataUrl: lastUserImage, isRegeneration: true });
}

// ==============================================
// 3) التحكم بمؤشر الكتابة / الرسم (Loading Indicator)
// ==============================================
function showTyping(mode = 'chat') {
  if (mode === 'image') {
    typingText.textContent = 'ريم ترسم لك الصورة الآن... 🎨';
  } else if (mode === 'bg') {
    typingText.textContent = 'ريم تُفرّغ خلفية الصورة الآن... ✂️';
  } else {
    typingText.textContent = 'ريم تكتب...';
  }
  typingIndicator.classList.remove('hidden');
  scrollToBottom();
}

function hideTyping() {
  typingIndicator.classList.add('hidden');
}

// ==============================================
// 4) تحويل النص إلى صوت (Text-to-Speech)
// باستخدام Web Speech API المجانية المدمجة بالمتصفح، مع دعم اختيار الصوت يدوياً
// ==============================================
let cachedVoices = [];
let selectedVoiceURI = null;

try { selectedVoiceURI = localStorage.getItem(LS_KEYS.voice) || null; } catch (err) { /* تجاهل */ }

function refreshVoices() {
  if (!window.speechSynthesis) return;
  cachedVoices = window.speechSynthesis.getVoices();

  // إذا لم نجد أصواتاً بعد، نحاول مجدداً بعد ثانية (شائع في أندرويد WebView)
  if (!cachedVoices.length) {
    setTimeout(refreshVoices, 1000);
    return;
  }

  populateVoiceSelect();
}
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}
refreshVoices();

// أسماء تدل على أصوات نسائية عربية عالية الجودة نفضّلها كافتراضي
const PREFERRED_FEMALE_VOICE_NAMES = ['salma', 'zariyah', 'natural', 'google', 'microsoft', 'hoda', 'laila', 'mariam'];

function pickBestArabicVoice() {
  if (!cachedVoices.length) refreshVoices();
  const arabicVoices = getArabicVoices();
  if (!arabicVoices.length) return null;

  // 1) إن اختار المستخدم صوتاً محدداً مسبقاً، نستخدمه إن كان لا يزال متاحاً
  if (selectedVoiceURI) {
    const savedVoice = arabicVoices.find((v) => v.voiceURI === selectedVoiceURI);
    if (savedVoice) return savedVoice;
  }

  // 2) وإلا نفضّل صوتاً نسائياً عربياً معروف الجودة
  const preferred = arabicVoices.find((v) =>
    PREFERRED_FEMALE_VOICE_NAMES.some((name) => v.name.toLowerCase().includes(name))
  );

  return preferred || arabicVoices.find((v) => v.lang.toLowerCase() === 'ar-sa') || arabicVoices[0];
}

// فلتر صارم: لا تُعرض أو تُستخدم إلا الأصوات العربية (سعودية، مصرية، إماراتية... إلخ)
function getArabicVoices() {
  return cachedVoices.filter((v) => v.lang && (v.lang.toLowerCase().startsWith('ar') || v.lang.toLowerCase().includes('ar')));
}

// نعرض حصرياً الأصوات العربية المتاحة في المتصفح/النظام (كل اللهجات)، ونتجاهل أي صوت غير عربي تماماً
function populateVoiceSelect() {
  if (!voiceSelect) return;
  const arabicVoices = getArabicVoices();
  if (!arabicVoices.length) return;

  const previousValue = voiceSelect.value;
  voiceSelect.innerHTML = '';

  arabicVoices.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = voice.name.replace(/^(Microsoft|Google)\s*/i, '');
    voiceSelect.appendChild(option);
  });

  // تحديد الصوت المناسب: المحفوظ سابقاً إن كان لا يزال متاحاً، أو أفضل صوت نسائي عربي، أو أول صوت عربي متاح
  const bestVoice = pickBestArabicVoice();
  const toSelect = (previousValue && arabicVoices.some((v) => v.voiceURI === previousValue))
    ? previousValue
    : (bestVoice ? bestVoice.voiceURI : arabicVoices[0].voiceURI);

  voiceSelect.value = toSelect;
  if (!selectedVoiceURI) selectedVoiceURI = toSelect;
}

if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    selectedVoiceURI = voiceSelect.value;
    try { localStorage.setItem(LS_KEYS.voice, selectedVoiceURI); } catch (err) { /* تجاهل */ }
  });
}

function speak(text, onEnd) {
  safeCancelSpeech();

  // تنظيف النص من رموز Markdown قبل النطق لتفادي قراءة الرموز حرفياً
  const cleanText = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>~-]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) { if (onEnd) onEnd(); return; }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'ar-SA';
  utterance.rate = 1;
  utterance.pitch = 1.05;
  utterance.volume = 1;

  const arabicVoice = pickBestArabicVoice();
  if (arabicVoice) utterance.voice = arabicVoice;

  if (onEnd) utterance.onend = onEnd;
  utterance.onerror = () => { if (onEnd) onEnd(); };

  window.speechSynthesis.speak(utterance);
}

// إيقاف النطق فوراً عند مغادرة المستخدم للتبويب (توفير للموارد وتجربة أفضل)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    safeCancelSpeech();
  }
});

// ==============================================
// 5) إرفاق الصور (رفع من الجهاز / الكاميرا / الملفات) + القائمة السفلية (+)
// ==============================================
function handleAttachedFile(file, inputEl) {
  if (!file) return;

  if (!file.type || !file.type.startsWith('image/')) {
    appendMessage({
      text: 'تدعم ريم حالياً إرفاق الصور فقط (PNG, JPEG, WEBP). سيتم دعم أنواع ملفات أخرى قريباً 📎',
      sender: 'bot',
      isError: true,
      isMarkdown: false,
    });
    if (inputEl) inputEl.value = '';
    return;
  }

  const maxSizeMB = 8;
  if (file.size > maxSizeMB * 1024 * 1024) {
    appendMessage({ text: `حجم الصورة كبير جداً (الحد الأقصى ${maxSizeMB} ميجابايت). الرجاء اختيار صورة أصغر.`, sender: 'bot', isError: true, isMarkdown: false });
    if (inputEl) inputEl.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImage = e.target.result;
    imagePreviewImg.src = pendingImage;
    imagePreviewBar.classList.remove('hidden');
    updateInputActionsVisibility();
    userInput.focus();
  };
  reader.readAsDataURL(file);
  if (inputEl) inputEl.value = ''; // للسماح باختيار نفس الملف مجدداً لاحقاً
}

imageInput.addEventListener('change', () => handleAttachedFile(imageInput.files && imageInput.files[0], imageInput));
cameraInput.addEventListener('change', () => handleAttachedFile(cameraInput.files && cameraInput.files[0], cameraInput));
fileInput.addEventListener('change', () => handleAttachedFile(fileInput.files && fileInput.files[0], fileInput));

removeImageBtn.addEventListener('click', () => {
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
  imagePreviewImg.src = '';
  updateInputActionsVisibility();
});

// ---------- القائمة السفلية المنزلقة (Bottom Sheet) لزر (+) ----------
function openAddSheet() {
  addSheetOverlay.classList.remove('hidden');
  addSheet.classList.remove('hidden');
  // نستخدم requestAnimationFrame لضمان تطبيق حالة "hidden" أولاً قبل بدء حركة الانزلاق
  requestAnimationFrame(() => {
    addSheetOverlay.classList.add('visible');
    addSheet.classList.add('visible');
  });
}

function closeAddSheet() {
  addSheetOverlay.classList.remove('visible');
  addSheet.classList.remove('visible');
  setTimeout(() => {
    addSheetOverlay.classList.add('hidden');
    addSheet.classList.add('hidden');
  }, 300);
}

addBtn.addEventListener('click', openAddSheet);
addSheetOverlay.addEventListener('click', closeAddSheet);

// ==============================================
// اختيار/التقاط صورة عبر كاميرا الجهاز الأصلية (Capacitor Camera Plugin)
// تُستخدم فقط عند التشغيل كتطبيق أندرويد حقيقي (IS_NATIVE_APP)، وإلا نستخدم
// عناصر <input type="file"> العادية كما في نسخة المتصفح/PWA (بدون أي تعديل).
// ==============================================
async function pickImageNative(source) {
  const Camera = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
  if (!Camera) {
    console.warn('إضافة @capacitor/camera غير مثبّتة/مُزامَنة (npm install + npx cap sync android).');
    appendMessage({
      text: 'ميزة الكاميرا غير مُفعّلة في هذه النسخة من التطبيق. يرجى تحديث التطبيق لاستخدامها 📷',
      sender: 'bot',
      isError: true,
      isMarkdown: false,
    });
    return;
  }
  try {
    const result = await Camera.getPhoto({
      quality: 85,
      resultType: 'dataUrl',                              // CameraResultType.DataUrl
      source: source === 'camera' ? 'CAMERA' : 'PHOTOS',   // CameraSource.Camera / CameraSource.Photos
      saveToGallery: false,
      correctOrientation: true,
    });

    pendingImage = result.dataUrl;
    imagePreviewImg.src = pendingImage;
    imagePreviewBar.classList.remove('hidden');
    updateInputActionsVisibility();
    userInput.focus();
  } catch (err) {
    // المستخدم ألغى العملية أو رفض إذن الكاميرا/المعرض - لا داعي لإظهار رسالة خطأ مزعجة
    console.warn('تعذّر التقاط/اختيار الصورة عبر الكاميرا الأصلية:', err);
  }
}

sheetImagesBtn.addEventListener('click', () => {
  closeAddSheet();
  if (IS_NATIVE_APP) {
    pickImageNative('gallery');
  } else {
    imageInput.click();
  }
});

sheetCameraBtn.addEventListener('click', () => {
  closeAddSheet();
  if (IS_NATIVE_APP) {
    pickImageNative('camera');
  } else {
    cameraInput.click();
  }
});

sheetFilesBtn.addEventListener('click', () => {
  closeAddSheet();
  fileInput.click();
});

sheetGenerateBtn.addEventListener('click', () => {
  closeAddSheet();
  userInput.value = 'ارسمي لي صورة: ';
  autoResizeInput();
  updateInputActionsVisibility();
  userInput.focus();
  // وضع المؤشر في نهاية النص
  const len = userInput.value.length;
  userInput.setSelectionRange(len, len);
});

// ==============================================
// 6) إرسال الرسالة إلى السيرفر واستقبال رد "ريم"
// ==============================================
function normalizePromptKey(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getImageCache() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.imageCache) || '{}');
  } catch (err) {
    return {};
  }
}

function saveImageToCache(promptKey, entry) {
  try {
    const cache = getImageCache();
    cache[promptKey] = entry;
    // نحدّ من حجم الكاش لتفادي تضخم localStorage (نحتفظ بآخر 60 صورة فقط)
    const keys = Object.keys(cache);
    if (keys.length > 60) {
      delete cache[keys[0]];
    }
    localStorage.setItem(LS_KEYS.imageCache, JSON.stringify(cache));
  } catch (err) {
    console.warn('تعذّر حفظ الصورة في الكاش المحلي:', err);
  }
}

function setSendingState(sending) {
  isSending = sending;
  if (sending) {
    sendIcon.setAttribute('data-lucide', 'square');
    sendBtn.title = 'إيقاف التوليد';
  } else {
    sendIcon.setAttribute('data-lucide', 'arrow-up');
    sendBtn.title = 'إرسال';
  }
  refreshIcons();
  updateInputActionsVisibility();
}

// يتحكم بإظهار زر الإرسال بدل أيقونتي الميكروفون/الموجة الصوتية عند وجود نص أو صورة مرفقة أو أثناء الإرسال
function updateInputActionsVisibility() {
  const hasContent = isSending || userInput.value.trim().length > 0 || !!pendingImage;
  if (hasContent) {
    micBtn.classList.add('hidden');
    waveBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
  } else {
    micBtn.classList.remove('hidden');
    waveBtn.classList.remove('hidden');
    sendBtn.classList.add('hidden');
  }
}

async function sendMessage() {
  // أثناء الإرسال، يتحول الزر إلى "إيقاف" — الضغط عليه يوقف الطلب الجاري
  if (isSending) {
    if (currentAbortController) currentAbortController.abort();
    return;
  }

  const message = userInput.value.trim();
  const imageDataUrl = pendingImage;

  if (!message && !imageDataUrl) return;

  userInput.value = '';
  autoResizeInput();
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
  imagePreviewImg.src = '';

  await performSend({ message, imageDataUrl });
}

async function performSend({ message, imageDataUrl, isRegeneration = false }) {
  if (isSending) return;
  setSendingState(true);
  hideConnectionBanner();

  if (!isRegeneration) {
    appendMessage({ text: message, sender: 'user', imageDataUrl, isMarkdown: false });
  }

  lastUserMessage = message || null;
  lastUserImage = imageDataUrl || null;

  // إن كانت هناك صورة مرفقة ونص يدل على رغبة بتفريغ/تعديل الخلفية، لهذا الطلب
  // الأولوية المطلقة على أنماط توليد الصور العامة (فهو تعديل حقيقي على الصورة نفسها).
  const wantsBgRemoval = !!imageDataUrl && isBgRemovalRequest(message);
  const wantsImage = !wantsBgRemoval && isImageGenerationRequest(message);
  showTyping(wantsBgRemoval ? 'bg' : (wantsImage ? 'image' : 'chat'));

  currentAbortController = new AbortController();

  try {
    // ---------- طلب تفريغ خلفية صورة مرفقة (Smart Routing تلقائي بدون اختيار أداة) ----------
    if (wantsBgRemoval) {
      appendMessage({
        text: 'جاري تفريغ خلفية الصورة مجاناً وبدقة عالية... ✂️',
        sender: 'bot',
        isMarkdown: false,
        withActions: false,
      });

      const imageBlob = dataUrlToBlob(imageDataUrl);
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');

      const response = await fetch(`${API_BASE_URL}/api/remove-bg`, {
        method: 'POST',
        body: formData,
        signal: currentAbortController.signal,
      });
      const data = await response.json();
      hideTyping();

      if (data.success) {
        appendMessage({
          text: 'تفضّلي، هذه صورتك بعد تفريغ الخلفية بالكامل ✂️✨',
          sender: 'bot',
          generatedImageUrl: data.imageUrl,
          withActions: false,
        });
      } else {
        appendMessage({ text: data.error || 'تعذّر تفريغ خلفية الصورة.', sender: 'bot', isError: true, isMarkdown: false });
      }
      return;
    }

    // ---------- طلب توليد/تعديل صورة ----------
    if (wantsImage) {
      const imgPrompt = extractImagePrompt(message);
      const promptKey = normalizePromptKey(imgPrompt) + (imageDataUrl ? '|with-image' : '');

      // إن كان الطلب مطابقاً لطلب سابق (بدون صورة مرفقة)، نعرض النتيجة المخزّنة فوراً من الكاش
      const cache = getImageCache();
      if (!imageDataUrl && cache[promptKey]) {
        hideTyping();
        appendMessage({
          text: 'تفضّلي، وجدت هذه الصورة جاهزة من قبل ⚡🎨',
          sender: 'bot',
          generatedImageUrl: cache[promptKey].imageUrl,
        });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imgPrompt,
          image: imageDataUrl || undefined,
        }),
        signal: currentAbortController.signal,
      });
      const data = await response.json();
      hideTyping();

      if (data.success) {
        saveImageToCache(promptKey, { imageUrl: data.imageUrl, promptUsed: data.promptUsed });
        appendMessage({
          text: imageDataUrl
            ? 'لا يمكنني تعديل بكسلات صورتك الأصلية مباشرة، لكنني أنشأت لكِ صورة جديدة مطوّرة مستوحاة منها وبناءً على طلبك 🎨✨'
            : 'تفضّلي، هذه الصورة التي رسمتها لكِ 🎨✨',
          sender: 'bot',
          generatedImageUrl: data.imageUrl,
          withActions: false,
        });
      } else {
        appendMessage({ text: data.error || 'تعذّر توليد الصورة.', sender: 'bot', isError: true, isMarkdown: false });
      }
      return;
    }

    // ---------- محادثة نصية / تحليل صورة ----------
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, image: imageDataUrl || undefined }),
      signal: currentAbortController.signal,
    });

    const data = await response.json();
    hideTyping();

    if (data.success) {
      // خط دفاع ثانٍ من السيرفر: قد يعيد صورة إن اكتشف نية رسم لم يلتقطها الفحص في المتصفح
      if (data.type === 'image' && data.imageUrl) {
        appendMessage({
          text: 'تفضّلي، هذه الصورة التي رسمتها لكِ 🎨✨',
          sender: 'bot',
          generatedImageUrl: data.imageUrl,
        });
      } else {
        appendMessage({ text: data.reply, sender: 'bot', withActions: true });
        if (autoSpeak) speak(data.reply);
      }
    } else {
      appendMessage({ text: data.error || 'حدث خطأ غير متوقع.', sender: 'bot', isError: true, isMarkdown: false });
    }
  } catch (error) {
    hideTyping();
    if (error.name === 'AbortError') {
      appendMessage({ text: 'تم إيقاف التوليد بناءً على طلبك ⏹️', sender: 'bot', isMarkdown: false });
    } else {
      showConnectionBanner('تعذّر الاتصال بالسيرفر 🌐 تأكدي من اتصالك بالإنترنت أو من تشغيل السيرفر، ثم حاولي مجدداً.');
      appendMessage({ text: 'تعذّر الاتصال بالسيرفر. تأكدي من تشغيله وحاولي مجدداً 🌐', sender: 'bot', isError: true, isMarkdown: false });
      console.error('خطأ في الاتصال:', error);
    }
  } finally {
    setSendingState(false);
    currentAbortController = null;
    userInput.focus();
  }
}

// ==============================================
// 6.1) تنبيه انقطاع الاتصال بالشبكة/السيرفر
// ==============================================
function showConnectionBanner(text) {
  connectionBannerText.textContent = text;
  connectionBanner.classList.remove('hidden');
}

function hideConnectionBanner() {
  connectionBanner.classList.add('hidden');
}

window.addEventListener('offline', () => {
  showConnectionBanner('انقطع اتصالك بالإنترنت 📴 سيتم استئناف المحادثة فور عودة الاتصال.');
});
window.addEventListener('online', () => {
  hideConnectionBanner();
});

// ==============================================
// 7) التحكم بزر القراءة الصوتية التلقائية للردود
// ==============================================
muteBtn.addEventListener('click', () => {
  autoSpeak = !autoSpeak;
  muteIcon.setAttribute('data-lucide', autoSpeak ? 'volume-2' : 'volume-x');
  refreshIcons();
  muteBtn.classList.toggle('active', autoSpeak);
  muteBtn.title = autoSpeak ? 'إيقاف القراءة الصوتية التلقائية' : 'تشغيل القراءة الصوتية التلقائية';

  if (!autoSpeak) {
    safeCancelSpeech();
  }
});

// ==============================================
// 8) زر تصفير المحادثة الحالية
// ==============================================
resetBtn.addEventListener('click', async () => {
  try {
    await fetch(`${API_BASE_URL}/api/reset`, { method: 'POST' });
  } catch (error) {
    console.error('تعذّر تصفير المحادثة على السيرفر:', error);
  }

  safeCancelSpeech();
  clearActiveConversationMessages();
  renderWelcomeMessage();
});

// ==============================================
// 9) تحويل الصوت إلى نص (Speech-to-Text) - إدخال سريع بالميكروفون
// ==============================================
// ⚠️ ملاحظة تقنية هامة: واجهة Web Speech API (window.SpeechRecognition) غير
// موجودة إطلاقاً داخل WebView الخاص بتطبيقات Capacitor/أندرويد (متوفرة فقط في
// متصفح Chrome العادي). لهذا كان زر المايك يختفي تماماً في نسخة الـ APK ولا
// يُطلب أي إذن مايكروفون. الحل: عند التشغيل كتطبيق أصلي، نستخدم "غلاف/Shim"
// يحاكي نفس واجهة SpeechRecognition القياسية (start/stop/onresult/onerror...)
// لكنه يعمل فعلياً عبر إضافة Capacitor الأصلية للتعرف الصوتي، فيبقى كل الكود
// الموجود أسفله (لزر المايك ولوضع المكالمة الصوتية) يعمل دون أي تعديل إضافي.
class NativeSpeechRecognitionShim {
  constructor() {
    this.lang = 'ar-SA';
    this.continuous = false;
    this.interimResults = false;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onresult = null;
    this._listening = false;
  }

  _getPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
  }

  _mapError(err) {
    const msg = ((err && (err.message || err.errorMessage)) || '').toLowerCase();
    console.error('Speech Recognition Raw Error:', err);

    // إظهار رسالة خطأ تقنية للمطور في الكونسول للمساعدة في التشخيص
    if (msg.includes('permission') || msg.includes('denied')) return 'not-allowed';
    if (msg.includes('no match') || msg.includes('empty') || msg.includes('no speech')) return 'no-speech';
    if (msg.includes('busy') || msg.includes('already')) return 'aborted';

    // إذا كان الخطأ غير معروف، نعيد 'network' كافتراضي مع تسجيل التفاصيل
    return 'network';
  }

  async start() {
    if (this._listening) {
      this.stop();
      return;
    }
    const plugin = this._getPlugin();
    if (!plugin) {
      console.warn('إضافة التعرف الصوتي الأصلية غير مثبّتة/مُزامَنة.');
      if (this.onerror) this.onerror({ error: 'not-allowed' });
      return;
    }

    try {
      // طلب الإذن صراحة قبل البدء لضمان عدم حدوث خطأ "شبكة" وهمي
      if (plugin.requestPermissions) {
        const perm = await plugin.requestPermissions();
        if (perm.speechRecognition !== 'granted') {
          if (this.onerror) this.onerror({ error: 'not-allowed' });
          return;
        }
      }

      this._listening = true;
      if (this.onstart) this.onstart();

      triggerHaptic('selection');

      const result = await plugin.start({
        language: this.lang || 'ar-SA',
        maxResults: 1,
        partialResults: false,
        popup: false,
      });

      this._listening = false;
      if (this.onend) this.onend();

      const transcript = result && Array.isArray(result.matches) && result.matches[0] ? result.matches[0] : '';
      if (transcript) {
        if (this.onresult) this.onresult({ results: [[{ transcript }]] });
      } else if (this.onerror) {
        this.onerror({ error: 'no-speech' });
      }
    } catch (err) {
      this._listening = false;
      if (this.onend) this.onend();
      if (this.onerror) this.onerror({ error: this._mapError(err) });
    }
  }

  stop() {
    const plugin = this._getPlugin();
    if (plugin && plugin.stop) {
      plugin.stop().catch(() => {});
    }
    this._listening = false;
  }
}

const SpeechRecognition = IS_NATIVE_APP
  ? NativeSpeechRecognitionShim
  : (window.SpeechRecognition || window.webkitSpeechRecognition);
let recognition = null;
let isRecording = false;

// ترجمة أكواد أخطاء SpeechRecognition إلى رسائل عربية واضحة للمستخدم
function getSpeechErrorMessage(errorCode) {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'يرجى التأكد من السماح باستخدام الميكروفون ومنح الإذن للتطبيق 🎙️';
    case 'no-speech':
      return 'لم أسمع أي صوت، حاولي التحدث بوضوح 🎙️';
    case 'audio-capture':
      return 'تعذّر العثور على ميكروفون مفعل 🎙️';
    case 'network':
      return 'خدمة التعرف الصوتي تواجه مشكلة حالياً. تأكدي من تحديث تطبيق (Google) على هاتفك أو جربي الكتابة 🌐';
    default:
      return 'حدث خطأ في التعرف على الصوت، يرجى المحاولة مرة أخرى 🎙️';
  }
}

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'ar-SA';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add('recording');
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove('recording');
  };

  recognition.onerror = (event) => {
    console.error('خطأ في التعرف على الصوت:', event.error);
    isRecording = false;
    micBtn.classList.remove('recording');
    appendMessage({
      text: getSpeechErrorMessage(event.error),
      sender: 'bot',
      isError: true,
      isMarkdown: false,
    });
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value = transcript;
    sendMessage();
  };

  micBtn.addEventListener('click', () => {
    if (isRecording) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        // قد تُرمى استثناء إذا كانت هناك جلسة استماع نشطة بالفعل؛ نتجاهلها بأمان
      }
    }
  });
} else {
  micBtn.style.display = 'none';
  console.warn('هذا المتصفح لا يدعم خاصية التعرف على الصوت (SpeechRecognition).');
}

// ==============================================
// 10) وضع المكالمة الصوتية المباشرة (📞)
// محادثة صوتية متواصلة: استماع -> إرسال -> نطق الرد -> استماع مجدداً
// ==============================================
let callRecognition = null;
let callActive = false;
let callMicMuted = false;
let callListening = false;
let callPaused = false; // true عند توقف إعادة المحاولة التلقائية بانتظار تدخّل المستخدم
let callConsecutiveErrors = 0; // عدّاد الأخطاء المتتالية لمنع التكرار اللانهائي
const CALL_MAX_AUTO_RETRIES = 3; // بعد هذا العدد من الأخطاء المتتالية نتوقف وننتظر إعادة اتصال يدوية

// أخطاء صلاحيات لا فائدة من إعادة المحاولة معها تلقائياً؛ يجب على المستخدم منح الإذن أولاً
const PERMISSION_ERROR_CODES = new Set(['not-allowed', 'service-not-allowed']);

function getCallRecognition() {
  if (!SpeechRecognition) return null;
  if (callRecognition) return callRecognition;

  callRecognition = new SpeechRecognition();
  callRecognition.lang = 'ar-SA';
  callRecognition.continuous = false;
  callRecognition.interimResults = false;

  callRecognition.onstart = () => {
    callListening = true;
  };

  callRecognition.onend = () => {
    callListening = false;
  };

  callRecognition.onerror = (event) => {
    callListening = false;
    if (!callActive) return;

    if (PERMISSION_ERROR_CODES.has(event.error)) {
      pauseCallForManualReconnect('يرجى التثبت من السماح باستخدام الميكروفون من إعدادات المتصفح 🎙️');
      return;
    }

    if (event.error === 'no-speech' || event.error === 'aborted') {
      callConsecutiveErrors += 1;
      if (callConsecutiveErrors >= CALL_MAX_AUTO_RETRIES) {
        pauseCallForManualReconnect('لم أتمكن من سماعك لفترة، اضغطي على زر إعادة الاتصال عند الاستعداد 🎙️');
        return;
      }
      restartCallListening();
      return;
    }

    callConsecutiveErrors += 1;
    if (callConsecutiveErrors >= CALL_MAX_AUTO_RETRIES) {
      pauseCallForManualReconnect(getSpeechErrorMessage(event.error));
      return;
    }
    setCallStatus('حدث خطأ في التعرف الصوتي، جاري إعادة المحاولة...', 'idle');
    restartCallListening();
  };

  callRecognition.onresult = async (event) => {
    callConsecutiveErrors = 0;
    const transcript = event.results[0][0].transcript;
    if (!transcript || !transcript.trim()) {
      restartCallListening();
      return;
    }
    await handleCallUserSpeech(transcript.trim());
  };

  return callRecognition;
}

function setCallStatus(text, mode) {
  callStatus.textContent = text;
  callWave.classList.remove('mode-listening', 'mode-speaking', 'mode-idle');
  callWave.classList.add(`mode-${mode || 'idle'}`);
}

function pauseCallForManualReconnect(message) {
  callPaused = true;
  setCallStatus(message, 'idle');
  callRetryBtn.classList.remove('hidden');
}

function resumeCallListening() {
  callPaused = false;
  callConsecutiveErrors = 0;
  callRetryBtn.classList.add('hidden');
  setCallStatus('جاري إعادة الاتصال... 🎙️', 'idle');
  restartCallListening();
}

function restartCallListening() {
  if (!callActive || callMicMuted || callPaused) return;
  setTimeout(() => {
    if (!callActive || callMicMuted || callPaused || callListening) return;
    setCallStatus('أستمع إليكِ... 🎧', 'listening');
    try {
      getCallRecognition().start();
    } catch (err) {
      // قد تُرمى استثناء إذا كانت جلسة الاستماع لا تزال نشطة؛ نتجاهلها بأمان
    }
  }, 400);
}

async function handleCallUserSpeech(transcript) {
  if (!callActive) return;
  setCallStatus('جاري التفكير في الرد...', 'idle');

  try {
    let replyText = null;

    if (isImageGenerationRequest(transcript)) {
      replyText = 'يمكنني رسم الصور من الشات الكتابي 🎨 أثناء المكالمة الصوتية سأكتفي بالحديث معكِ نصياً.';
    } else {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: transcript }),
      });
      const data = await response.json();
      replyText = data.success ? data.reply : (data.error || 'عذراً، حدث خطأ ما.');
    }

    appendMessage({ text: transcript, sender: 'user', isMarkdown: false });
    appendMessage({ text: replyText, sender: 'bot', withActions: true });

    if (!callActive) return;
    setCallStatus('ريم تتحدث... 🌸', 'speaking');
    speak(replyText, () => {
      if (!callActive) return;
      restartCallListening();
    });
  } catch (error) {
    console.error('⚠️ خطأ أثناء المكالمة:', error);
    appendMessage({ text: 'حدث خطأ في الاتصال بالسيرفر أثناء المكالمة 🌐', sender: 'bot', isError: true, isMarkdown: false });
    callConsecutiveErrors += 1;
    if (callConsecutiveErrors >= CALL_MAX_AUTO_RETRIES) {
      pauseCallForManualReconnect('تعذّر الاتصال بالسيرفر، اضغطي على زر إعادة الاتصال بعد التأكد من الاتصال بالإنترنت 🌐');
      return;
    }
    setCallStatus('تعذّر الاتصال بالسيرفر، جاري إعادة المحاولة...', 'idle');
    restartCallListening();
  }
}

function startCall() {
  if (!SpeechRecognition) {
    appendMessage({ text: 'عذراً، جهازك لا يدعم خاصية التعرف على الصوت اللازمة للمكالمة.', sender: 'bot', isError: true, isMarkdown: false });
    return;
  }

  triggerHaptic('impact');

  callActive = true;
  callMicMuted = false;
  callPaused = false;
  callConsecutiveErrors = 0;

  // إخفاء أي تنبيهات سابقة
  callRetryBtn.classList.add('hidden');
  callMicToggleBtn.classList.remove('muted');
  callMicToggleBtn.innerHTML = '<i data-lucide="mic"></i>';

  // إظهار واجهة الاتصال فوراً وضمان الـ z-index
  callOverlay.classList.remove('hidden');
  callOverlay.style.setProperty('display', 'flex', 'important');
  setCallStatus('جاري بدء الاتصال... 🌸', 'idle');

  refreshIcons();

  safeCancelSpeech();

  // البدء الفعلي للاستماع بعد قليل لضمان استقرار الواجهة
  setTimeout(() => {
    if (callActive) restartCallListening();
  }, 800);
}

function endCall() {
  console.log('Ending call process...');
  triggerHaptic('impact');
  callActive = false;
  callMicMuted = false;
  callPaused = false;
  callConsecutiveErrors = 0;

  safeCancelSpeech();

  if (callRecognition) {
    try {
      callRecognition.onend = null;
      callRecognition.onresult = null;
      callRecognition.onerror = null;
      callRecognition.stop();
    } catch (err) {
      console.warn('Error stopping call recognition:', err);
    }
  }

  callOverlay.classList.add('hidden');
  callOverlay.style.setProperty('display', 'none', 'important');
  console.log('☎️ تم إنهاء المكالمة بنجاح.');
}

// إتاحة الدوال للـ HTML
window.startCall = startCall;
window.endCall = endCall;

callBtn.addEventListener('click', startCall);
endCallBtn.addEventListener('click', endCall);
callRetryBtn.addEventListener('click', () => {
  if (!callActive) return;
  resumeCallListening();
});

callMicToggleBtn.addEventListener('click', () => {
  callMicMuted = !callMicMuted;
  callMicToggleBtn.classList.toggle('muted', callMicMuted);
  callMicToggleBtn.innerHTML = callMicMuted ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="mic"></i>';
  refreshIcons();
  if (callMicMuted) {
    if (callRecognition) { try { callRecognition.stop(); } catch (err) { /* تجاهل */ } }
    setCallStatus('الميكروفون مكتوم', 'idle');
  } else {
    restartCallListening();
  }
});

// ==============================================
// 11) الوضع الداكن / الفاتح (Dark / Light Mode)
// ==============================================
function getStoredTheme() {
  try { return localStorage.getItem(LS_KEYS.theme); } catch (err) { return null; }
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (themeToggleLabel) themeToggleLabel.textContent = 'الوضع الفاتح';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (themeToggleLabel) themeToggleLabel.textContent = 'الوضع الداكن';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(LS_KEYS.theme, next); } catch (err) { /* تجاهل */ }
}

if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
applyTheme(getStoredTheme() === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

// ==============================================
// 12) الشريط الجانبي (Sidebar) وإدارة المحادثات المتعددة
// ==============================================
function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.remove('hidden');
  renderConversationList();
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.add('hidden');
}

menuBtn.addEventListener('click', openSidebar);
sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

function loadConversations() {
  try {
    const raw = localStorage.getItem(LS_KEYS.conversations);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function saveConversations(conversations) {
  try {
    localStorage.setItem(LS_KEYS.conversations, JSON.stringify(conversations));
  } catch (err) {
    console.warn('تعذّر حفظ سجل المحادثات محلياً:', err);
  }
}

function getActiveConversationId() {
  try { return localStorage.getItem(LS_KEYS.activeConversation); } catch (err) { return null; }
}

function setActiveConversationId(id) {
  try { localStorage.setItem(LS_KEYS.activeConversation, id); } catch (err) { /* تجاهل */ }
}

function createConversation() {
  const conversations = loadConversations();
  const newConv = {
    id: `conv_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    title: 'محادثة جديدة',
    createdAt: Date.now(),
    messages: [],
  };
  conversations.unshift(newConv);
  saveConversations(conversations);
  setActiveConversationId(newConv.id);
  return newConv;
}

function getOrCreateActiveConversation() {
  const conversations = loadConversations();
  const activeId = getActiveConversationId();
  let active = conversations.find((c) => c.id === activeId);
  if (!active) {
    active = createConversation();
  }
  return active;
}

function saveMessageToActiveConversation(message) {
  const conversations = loadConversations();
  const activeId = getActiveConversationId();
  let conv = conversations.find((c) => c.id === activeId);
  if (!conv) return;

  conv.messages.push(message);

  // تحديد عنوان المحادثة تلقائياً من أول رسالة نصية للمستخدم
  if (conv.title === 'محادثة جديدة' && message.sender === 'user' && message.text && message.text.trim()) {
    conv.title = message.text.trim().slice(0, 40);
  }

  saveConversations(conversations);
  renderConversationList();
}

function removeLastMessageFromActiveConversation() {
  const conversations = loadConversations();
  const activeId = getActiveConversationId();
  const conv = conversations.find((c) => c.id === activeId);
  if (!conv || !conv.messages.length) return;
  conv.messages.pop();
  saveConversations(conversations);
}

function clearActiveConversationMessages() {
  const conversations = loadConversations();
  const activeId = getActiveConversationId();
  const conv = conversations.find((c) => c.id === activeId);
  if (conv) {
    conv.messages = [];
    conv.title = 'محادثة جديدة';
    saveConversations(conversations);
  }
  chatWindow.innerHTML = '';
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
  lastUserMessage = null;
  lastUserImage = null;
  renderConversationList();
}

function renderWelcomeMessage() {
  appendMessage({ text: WELCOME_TEXT, sender: 'bot', isMarkdown: false, persist: true });
}

function renderConversationList() {
  const conversations = loadConversations();
  const activeId = getActiveConversationId();
  conversationList.innerHTML = '';

  if (!conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = 'لا توجد محادثات محفوظة بعد.';
    conversationList.appendChild(empty);
    return;
  }

  conversations.forEach((conv) => {
    const item = document.createElement('div');
    item.className = `conversation-item ${conv.id === activeId ? 'active' : ''}`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'conversation-item-title';
    titleSpan.textContent = conv.title || 'محادثة جديدة';
    item.appendChild(titleSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'conversation-delete-btn';
    deleteBtn.title = 'حذف المحادثة';
    deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });
    item.appendChild(deleteBtn);

    item.addEventListener('click', () => switchToConversation(conv.id));
    conversationList.appendChild(item);
  });

  refreshIcons();
}

function switchToConversation(id) {
  setActiveConversationId(id);
  safeCancelSpeech();
  loadActiveConversationIntoChatWindow();
  closeSidebar();
}

function deleteConversation(id) {
  let conversations = loadConversations();
  conversations = conversations.filter((c) => c.id !== id);
  saveConversations(conversations);

  if (getActiveConversationId() === id) {
    if (conversations.length) {
      setActiveConversationId(conversations[0].id);
    } else {
      createConversation();
    }
    loadActiveConversationIntoChatWindow();
  }
  renderConversationList();
}

newChatBtn.addEventListener('click', () => {
  safeCancelSpeech();
  createConversation();
  chatWindow.innerHTML = '';
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
  lastUserMessage = null;
  lastUserImage = null;
  renderWelcomeMessage();
  renderConversationList();
  closeSidebar();
});

clearAllBtn.addEventListener('click', () => {
  const conversations = loadConversations();
  if (!conversations.length) return;
  const confirmed = window.confirm('هل تريدين مسح كل المحادثات المحفوظة نهائياً؟');
  if (!confirmed) return;

  saveConversations([]);
  createConversation();
  chatWindow.innerHTML = '';
  renderWelcomeMessage();
  renderConversationList();
});

// يعيد بناء نافذة المحادثة من الرسائل المحفوظة في المحادثة النشطة حالياً
function loadActiveConversationIntoChatWindow() {
  const conv = getOrCreateActiveConversation();
  chatWindow.innerHTML = '';
  pendingImage = null;
  imagePreviewBar.classList.add('hidden');
  lastUserMessage = null;
  lastUserImage = null;

  if (!conv.messages.length) {
    renderWelcomeMessage();
    return;
  }

  conv.messages.forEach((msg) => {
    appendMessage({ ...msg, persist: false });
    if (msg.sender === 'user') {
      lastUserMessage = msg.text || null;
      lastUserImage = msg.imageDataUrl || null;
    }
  });
}

// ==============================================
// 13) تكبير مربع الإدخال تلقائياً + إرسال بزر Enter (مع Shift+Enter لسطر جديد)
// ==============================================
function autoResizeInput() {
  userInput.style.height = 'auto';
  userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
}

userInput.addEventListener('input', () => {
  autoResizeInput();
  updateInputActionsVisibility();
});

sendBtn.addEventListener('click', sendMessage);
waveBtn.addEventListener('click', startCall);

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  // Shift+Enter: يُترك للسلوك الافتراضي (سطر جديد داخل textarea)
});

// ==============================================
// 14) الشاشة الافتتاحية (Splash Screen) + التهيئة الأولية
// ==============================================
window.addEventListener('load', () => {
  refreshIcons();
  getOrCreateActiveConversation();
  loadActiveConversationIntoChatWindow();
  renderConversationList();

  userInput.focus();
  updateInputActionsVisibility();
  setTimeout(() => {
    if (splashScreen) {
      splashScreen.classList.add('splash-hidden');
      setTimeout(() => splashScreen.remove(), 600);
    }
  }, 1100);
});
