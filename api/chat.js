// Локальный кэш промпта (живет в рамках serverless инстанса)
let cachedPrompt = null;
let promptCacheTime = 0;
const PROMPT_CACHE_TTL = 10 * 60 * 1000; // 10 минут

function getCachedPrompt(sessionPrompt) {
  const now = Date.now();
  if (cachedPrompt && (now - promptCacheTime < PROMPT_CACHE_TTL)) {
    return cachedPrompt;
  }
  cachedPrompt = sessionPrompt;
  promptCacheTime = now;
  return cachedPrompt;
}

// Circuit Breaker для OpenAI API
const circuitBreaker = {
  failures: 0,
  lastFailureTime: null,
  threshold: 3, // После 3 неудач переходим в "open" состояние (более агрессивно)
  timeout: 30000, // 30 секунд в "open" состоянии (быстрее восстановление)
  state: 'closed' // closed, open, half-open
};

// Проверка состояния Circuit Breaker
function isCircuitOpen() {
  if (circuitBreaker.state === 'open') {
    if (Date.now() - circuitBreaker.lastFailureTime > circuitBreaker.timeout) {
      circuitBreaker.state = 'half-open';
      circuitBreaker.failures = 0;
      console.log('Circuit breaker: переход в half-open состояние');
    }
    return circuitBreaker.state === 'open';
  }
  return false;
}

// Catalog module removed - no longer needed

// Import rate limiter
const { checkRateLimit } = require('../utils/rate-limiter');

// Используем единый Redis клиент с retry логикой
const redis = require('../utils/redis-client');

// Функция для определения источника из запроса
function detectSource(req) {
  // Пробуем получить из referer
  const referer = req.headers.referer || req.headers.origin || '';
  if (referer && referer.includes('nm-shop.by')) {
    return 'nm-shop';
  }
  // По умолчанию 'test' для Vercel виджета
  return 'test';
}

// Функция для отслеживания ошибок отключена для экономии Redis команд
// async function trackError(errorType, message, req, additionalData = {}) {
//   ... код удален для оптимизации ...
// }

// Вспомогательная функция для проверки повторяющихся цифр
function isRepeatingDigits(digits) {
  if (digits.length <= 10) return false;
  const firstDigit = digits[0];
  return digits.split('').every(d => d === firstDigit);
}

// Парсер телефонов из текста сообщения
function parsePhoneFromMessage(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // Игнорируем сообщения бота (содержат маркеры бота)
  const botMarkers = ['закреплю', 'подборка', 'мессенджер', 'дизайнер свяж', 'передам', 'подготовлю'];
  const lowerText = text.toLowerCase();
  if (botMarkers.some(marker => lowerText.includes(marker))) {
    return null;
  }
  
  // Явная проверка на артикулы типа M00-XXXXXX в исходном тексте
  // Если найден такой артикул, исключаем его из дальнейшего поиска телефонов
  const m00ArticlePattern = /[Mm]\s*00\s*-\s*\d+/i;
  if (m00ArticlePattern.test(text)) {
    // Удаляем артикулы M00-XXXXXX из текста перед поиском телефонов
    text = text.replace(/[Mm]\s*00\s*-\s*\d+/gi, '');
  }
  
  // Удаляем артикулы/номера моделей (буква + цифры с дефисами) перед поиском телефона
  // Улучшенный паттерн: М00-009915, А123-456, Т-999, M 00-010151 (с пробелами) и т.д.
  const articlePattern = /[А-ЯA-Z]\s*\d+[\s\-]*\d*/gi;
  let cleanedText = text.replace(articlePattern, '');
  
  // Ищем последовательности с цифрами, пробелами, дефисами, скобками, плюсом
  // Сначала ищем полные форматы (+375, 375, 80)
  const fullPhonePatterns = [
    /\+375[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,3}[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,2}/, // +375 29 390 85 96
    /375[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,3}[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,2}/,   // 375 29 390-85-96
    /80[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,3}[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,2}/,     // 8 0 29 5 555 55
    /8[\s\-\(\)]*0[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,3}[\s\-\(\)]*\d{1,2}[\s\-\(\)]*\d{1,2}/ // 8 0 29 с пробелами
  ];
  
  for (const pattern of fullPhonePatterns) {
    const match = cleanedText.match(pattern);
    if (match) {
      const phoneStr = match[0].trim();
      // Пропускаем коды товаров, начинающиеся с M00
      if (/^[Mm]00/i.test(phoneStr)) {
        continue;
      }
      // Пропускаем последовательности, начинающиеся с 00- (это остаток артикула M00-XXXXXX)
      if (/^00\s*-/i.test(phoneStr)) {
        continue;
      }
      // Проверяем что после удаления всех нецифровых символов остается минимум 9 цифр
      const digitsOnly = phoneStr.replace(/\D/g, '');
      // Проверяем максимальную длину (15 цифр - стандарт E.164) и повторяющиеся цифры
      if (digitsOnly.length >= 9 && digitsOnly.length <= 15 && !isRepeatingDigits(digitsOnly)) {
        return phoneStr;
      }
    }
  }
  
  // Ищем короткие номера (7+ цифр подряд или с пробелами)
  const shortPhonePattern = /[\d\s\-\(\)]{7,}/g;
  const matches = cleanedText.match(shortPhonePattern);
  if (matches) {
    for (const match of matches) {
      const digitsOnly = match.replace(/\D/g, '');
      // Пропускаем коды товаров, начинающиеся с M00
      const matchTrimmed = match.trim();
      if (/^[Mm]00/i.test(matchTrimmed)) {
        continue;
      }
      // Пропускаем последовательности, начинающиеся с 00- (это остаток артикула M00-XXXXXX)
      if (/^00\s*-/i.test(matchTrimmed)) {
        continue;
      }
      // Если это минимум 7 цифр и не выглядит как год/дата (не начинается с 19xx или 20xx)
      // Проверяем максимальную длину (15 цифр) и повторяющиеся цифры
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15 && !/^(19|20)\d{2}/.test(digitsOnly) && !isRepeatingDigits(digitsOnly)) {
        return matchTrimmed;
      }
    }
  }
  
  return null;
}

// Сохранение диалога в Redis
async function saveChat(sessionId, userMessage, botReply) {
  try {
    const chatKey = `chat:${sessionId}`;
    
    console.log('🔍 saveChat: Читаем сессию из Redis, ключ:', chatKey);
    // Читаем существующую сессию
    let session = await redis.get(chatKey);
    console.log('🔍 saveChat: Прочитано из Redis:', {
      found: !!session,
      hasMessages: session && session.messages ? session.messages.length : 'N/A',
      sessionType: typeof session
    });
    
    if (!session) {
      console.log('⚠️ saveChat: Сессия не найдена, создаем новую');
      // Определяем источник из текущего запроса
      const source = global.currentRequest ? detectSource(global.currentRequest) : 'test';
      session = {
        sessionId,
        source: source, // Устанавливаем источник сразу
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messages: []
      };
    }
    
    // Защита: проверяем что messages - это массив
    if (!Array.isArray(session.messages)) {
      console.warn('⚠️ session.messages не массив, исправляем:', typeof session.messages);
      session.messages = [];
    }
    
    console.log('🔍 saveChat: Добавляем сообщения. Текущее кол-во:', session.messages ? session.messages.length : 0);
    
    // Добавляем сообщения
    session.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });
    
    session.messages.push({
      role: 'assistant',
      content: botReply,
      timestamp: new Date().toISOString()
    });
    
    session.lastUpdated = new Date().toISOString();
    
    // Определяем источник сессии - если не задан, определяем из текущего запроса
    if (!session.source && global.currentRequest) {
      session.source = detectSource(global.currentRequest);
      console.log('🔍 saveChat: Источник не был установлен, определен из запроса:', session.source);
    }
    if (!session.source) {
      session.source = 'test'; // Fallback
    }
    
    const source = session.source;
    const sessionsListKey = source === 'nm-shop' ? 'sessions:list:nm-shop' : 'sessions:list:test';
    
    // Сохраняем в Redis
    console.log('🔧 ПЕРЕД redis.set: messages.length =', session.messages.length, 'source =', source);
    await redis.setex(chatKey, 30 * 24 * 60 * 60, session); // TTL 30 дней
    // Убеждаемся, что сессия добавлена в соответствующий список сессий
    await redis.sadd(sessionsListKey, sessionId);
    // Обновляем индекс для быстрого поиска в админке
    await redis.updateSessionIndex(sessionId, source, session.lastUpdated);
    console.log('✅ redis.set выполнен, сессия добавлена в', sessionsListKey);
    
    // Убрана verification проверка для экономии Redis команд (GET после SET не нужен)
    
    console.log('Диалог сохранен в Redis для сессии:', sessionId, 'источник:', source);
    
    // Парсинг и отправка телефона из чата (в фоне, не блокируя ответ)
    processPhoneFromChat(session, sessionId, userMessage).catch(err => {
      console.error('Ошибка обработки телефона из чата:', err);
    });
    
    return true;
  } catch (error) {
    console.error('Ошибка сохранения диалога в Redis:', error);
    // Отслеживаем ошибки Redis через глобальную переменную req (будет доступна в handler)
    // Отключено для экономии Redis команд
    // if (global.currentRequest) {
    //   trackError('redis_error', `Redis error in saveChat: ${error.message}`, global.currentRequest).catch(() => {});
    // }
    return false;
  }
}

// Обработка телефона из чата и отправка в GAS
async function processPhoneFromChat(session, sessionId, userMessage) {
  try {
    // Проверка условий: пропускаем если уже есть контакты или телефон уже был захвачен
    if (session.contacts && session.contacts.phone && session.contacts.phone.trim()) {
      return; // Телефон уже сохранен через форму
    }
    
    if (session.chatPhoneCaptured) {
      return; // Телефон из чата уже был отправлен
    }
    
    // Парсим телефон из сообщения пользователя
    const phone = parsePhoneFromMessage(userMessage);
    if (!phone) {
      return; // Телефон не найден
    }
    
    console.log('📱 Найден телефон в чате:', phone, 'для сессии:', sessionId);
    
    // Получаем GAS URL из переменных окружения
    const GAS_URL = process.env.GAS_URL;
    if (!GAS_URL) {
      console.warn('⚠️ GAS_URL не задан, не могу отправить телефон из чата');
      return;
    }
    
    // Получаем page_url из сессии или referer
    const req = global.currentRequest;
    const pageUrl = session.pageUrl || (req ? (req.headers.referer || req.headers.origin || '') : '');
    
    // Формируем payload для GAS
    const payload = {
      timestamp: new Date().toISOString(),
      phone: phone, // Сохраняем как клиент написал
      pretext: 'Телефон из чата',
      page_url: pageUrl,
      session_id: sessionId,
      name: '', // Пустое поле
      category: '', // Пустое поле
      gift: '', // Пустое поле
      messenger: '', // Пустое поле
      wishes: '' // Пустое поле
    };
    
    // Retry логика для отправки телефона из чата в GAS
    const maxRetries = 3;
    let lastError = null;
    let sendSuccess = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 секунд таймаут для GAS
      
      try {
        console.log(`📤 Отправляем телефон из чата в GAS (попытка ${attempt}/${maxRetries}):`, phone);
        console.log('🔗 GAS URL:', GAS_URL ? GAS_URL.substring(0, 50) + '...' : 'НЕ ЗАДАН');
        console.log('📦 Payload для GAS:', JSON.stringify(payload, null, 2));
        
        const r = await fetch(GAS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        // ВАЖНО: Проверяем статус ДО чтения тела ответа
        // Если статус 200, запрос успешен, даже если тело не прочитано
        if (r.ok || r.status === 200) {
          clearTimeout(timeoutId);
          console.log('✅ Статус 200 получен от GAS, запрос успешен');
          console.log('📥 Ответ от GAS получен:', {
            status: r.status,
            statusText: r.statusText,
            ok: r.ok
          });
          
          // Пытаемся прочитать тело ответа, но не критично если не получится
          try {
            const responseText = await Promise.race([
              r.text(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Read timeout')), 5000))
            ]);
            console.log('📄 Текст ответа от GAS:', responseText.substring(0, 500));
          } catch (readError) {
            console.warn('⚠️ Не удалось прочитать тело ответа, но статус 200 - считаем успехом');
          }
          
          console.log(`✅✅✅ Телефон из чата успешно отправлен в GAS (попытка ${attempt}):`, phone);
          console.log('📊 Детали успешной отправки:', {
            status: r.status,
            statusText: r.statusText,
            phone: phone
          });
          lastError = null; // Сброс ошибки при успехе
          sendSuccess = true;
          break; // Выходим из цикла retry
        }
        
        // Если статус не 200, читаем тело для диагностики
        clearTimeout(timeoutId);
        
        console.log('📥 Ответ от GAS получен:', {
          status: r.status,
          statusText: r.statusText,
          ok: r.ok
        });
        
        // GAS может возвращать разные форматы ответов
        let responseData;
        let responseText = '';
        try {
          responseText = await r.text();
          console.log('📄 Текст ответа от GAS:', responseText.substring(0, 500));
          
          try {
            responseData = JSON.parse(responseText);
            console.log('✅ JSON ответ от GAS распарсен:', responseData);
          } catch (parseError) {
            console.warn('⚠️ Ответ не JSON, пытаемся определить успех по тексту');
            // Если не JSON, проверяем текст
            if (responseText.includes('ok') || responseText.includes('success') || responseText.includes('true') || r.ok) {
              responseData = { ok: true, text: responseText };
              console.log('✅ Определен как успех по тексту');
            } else {
              responseData = { ok: false, text: responseText };
              console.log('❌ Определен как ошибка по тексту');
            }
          }
        } catch (parseError) {
          console.error('❌ Ошибка чтения ответа GAS:', parseError);
          throw new Error(`GAS upstream error: ${r.status}`);
        }
        
        if (responseData.ok || r.ok || r.status === 0) {
          console.log(`✅✅✅ Телефон из чата успешно отправлен в GAS (попытка ${attempt}):`, phone);
          console.log('📊 Детали успешной отправки:', {
            status: r.status,
            statusText: r.statusText,
            responseData: responseData,
            phone: phone
          });
          lastError = null; // Сброс ошибки при успехе
          sendSuccess = true;
          break; // Выходим из цикла retry
        } else {
          console.error('❌❌❌ GAS вернул ошибку:', { 
            status: r.status, 
            statusText: r.statusText,
            responseData: responseData,
            responseText: responseText.substring(0, 500)
          });
          throw new Error(`GAS returned error: ${JSON.stringify(responseData)}`);
        }
        
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        
        // ВАЖНО: При таймауте все же делаем retry, чтобы гарантировать доставку лида
        // Лучше дубликат, чем потерянный лид
        if (error.name === 'AbortError') {
          console.error(`❌ Таймаут при отправке телефона из чата (попытка ${attempt}/${maxRetries})`);
          console.warn('⚠️ Запрос мог быть обработан на стороне GAS, но ответ не успел вернуться');
          
          if (attempt === maxRetries) {
            // Последняя попытка с таймаутом - считаем что запрос мог быть успешным
            // чтобы не потерять лид (лучше дубликат, чем потеря)
            console.warn('⚠️ Последняя попытка с таймаутом - считаем что запрос мог быть успешным');
            console.error('❌❌❌ Таймаут при отправке телефона из чата в GAS после всех попыток');
            // НЕ устанавливаем sendSuccess = true, чтобы не обновлять сессию
            // но лид мог быть сохранен в GAS
          } else {
            // Делаем retry при таймауте, чтобы гарантировать доставку лида
            const delay = 1000 * Math.pow(2, attempt - 1);
            console.log(`⏳ Повторная попытка отправки телефона из чата через ${delay}ms (после таймаута)...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } else {
          console.error(`❌ Ошибка отправки телефона из чата (попытка ${attempt}/${maxRetries}):`, error.message);
          
          if (attempt === maxRetries) {
            // Последняя попытка неудачна - логируем, но не прерываем работу
            console.error('❌❌❌ Все попытки отправки телефона из чата в GAS неудачны:', lastError);
          } else {
            // Экспоненциальная задержка: 1s, 2s
            const delay = 1000 * Math.pow(2, attempt - 1);
            console.log(`⏳ Повторная попытка отправки телефона из чата через ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
    }
    
    // Обновляем сессию только при успешной отправке
    if (sendSuccess) {
      console.log('✅✅✅ УСПЕХ: Телефон из чата успешно отправлен в GAS после всех попыток');
      
      // Отмечаем что телефон был захвачен и сохраняем его - читаем свежую версию из Redis
      const chatKey = `chat:${sessionId}`;
      try {
        const currentSession = await redis.get(chatKey);
        if (currentSession) {
          currentSession.chatPhoneCaptured = true;
          // Сохраняем телефон в отдельном объекте для отображения в админке
          if (!currentSession.chatContacts) {
            currentSession.chatContacts = {};
          }
          currentSession.chatContacts.phone = phone;
          currentSession.chatContacts.timestamp = new Date().toISOString();
          currentSession.lastUpdated = new Date().toISOString();
          await redis.setex(chatKey, 30 * 24 * 60 * 60, currentSession); // Обновляем сессию
          
          // Обновляем индекс
          const source = currentSession.source || 'test';
          await redis.updateSessionIndex(sessionId, source, currentSession.lastUpdated);
          
          // Инкрементируем счетчик лидов из чата для аналитики
          const analyticsKey = `analytics:chat_phone_lead:${source}`;
          try {
            await redis.incr(analyticsKey);
            console.log('📊 Счетчик лидов из чата инкрементирован для источника:', source);
          } catch (analyticsError) {
            console.warn('⚠️ Не удалось инкрементировать счетчик лидов из чата:', analyticsError.message);
          }
        }
      } catch (updateError) {
        console.warn('⚠️ Не удалось обновить флаг chatPhoneCaptured:', updateError.message);
      }
      
      return true;
    } else {
      // Если все попытки неудачны, логируем но не обновляем сессию
      console.warn('⚠️ Телефон из чата не был отправлен в GAS после всех попыток:', phone);
      return false;
    }
  } catch (error) {
    console.error('Ошибка processPhoneFromChat:', error);
  }
}

const CATEGORY_PATTERNS = [
  { category: 'Диван', patterns: [/диван/, /соф/, /тахт/, /канап/, /углов/, /п-образ/, /раскладн/, /модульн/] },
  { category: 'Кровать', patterns: [/кроват/, /спалн/, /матрас/, /изголов/, /подъемн/, /основан/, /ортопед/] },
  { category: 'Кухня', patterns: [/кухн/, /гарнитур/, /кухон/, /столешн/, /фасад/, /пенал кух/, /остров/ ] },
  { category: 'Другое', patterns: [/стол(?!еш)/, /стул/, /шкаф/, /прихож/, /комод/, /тумб/, /кресл/, /банкет/, /стенка/, /обеденн/, /журнальн/, /полк/] }
];

const PRODUCT_HINTS = [
  /мебел/, /подбер/, /ищу/, /нужен/, /нужна/, /нужны/, /интересует/, /вариант/, /цвет/,
  /размер/, /материал/, /ткан/, /фабрик/, /в наличии/, /ассортимент/, /модель/, /комплект/,
  /цена/, /стоимост/, /бюджет/, /сколько стоит/, /покажите/, /подскажите по/, /расскажите про/
];

const SERVICE_HINTS = [
  /достав/, /оплат/, /рассроч/, /кредит/, /гарант/, /возврат/, /обмен/, /салон/, /шоурум/,
  /адрес/, /где наход/, /режим/, /график/, /контакт/, /телефон/, /номер/, /самовывоз/,
  /как доехать/, /когда открыт/, /время работы/
];

const GREETING_PATTERNS = [
  /^привет[!. ]?$/,
  /^здравствуй(те)?[!. ]?$/,
  /^добрый (день|вечер|утро)[!. ]?$/,
  /^hello[!. ]?$/,
  /^hi[!. ]?$/
];

// Определение типа вопроса и категории товара (локально, без второго запроса в OpenAI)
async function analyzeUserMessage(userMessage = '') {
  if (typeof userMessage !== 'string') {
    return { isProductQuestion: false, detectedCategory: null };
  }
  
  const normalized = userMessage
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!normalized) {
    return { isProductQuestion: false, detectedCategory: null };
  }
  
  const greetingOnly = GREETING_PATTERNS.some(pattern => pattern.test(normalized));
  if (greetingOnly) {
    return { isProductQuestion: false, detectedCategory: null };
  }
  
  let detectedCategory = null;
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some(pattern => pattern.test(normalized))) {
      detectedCategory = category;
      break;
    }
  }
  
  let isProductQuestion = Boolean(detectedCategory);
  
  if (!isProductQuestion && PRODUCT_HINTS.some(pattern => pattern.test(normalized))) {
    isProductQuestion = true;
  }
  
  // Бюджет почти всегда означает подбор конкретного товара
  if (!isProductQuestion && /\d+[\s-]*(byn|руб|р\.?\b)/.test(normalized)) {
    isProductQuestion = true;
  }
  
  const isServiceQuestion = SERVICE_HINTS.some(pattern => pattern.test(normalized));
  if (isServiceQuestion && !isProductQuestion) {
    return { isProductQuestion: false, detectedCategory: null };
  }
  
  return {
    isProductQuestion,
    detectedCategory: isProductQuestion ? detectedCategory : null
  };
}

async function handler(req, res){
  // Сохраняем req в глобальной переменной для доступа в других функциях
  global.currentRequest = req;
  
  // Логирование всех входящих запросов
  const requestTimestamp = new Date().toISOString();
  console.log(`[${requestTimestamp}] Incoming request:`, {
    method: req.method,
    url: req.url,
    referer: req.headers.referer || req.headers.origin || 'not set',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 100) : 'not set'
  });
  
  // Add CORS headers for external domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Pragma');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    console.log(`[${requestTimestamp}] Method not allowed:`, req.method);
    return res.status(405).end();
  }
  
  try{
    const { action, session_id, user_message, history_tail, prompt, locale, aggressive_mode, user_messages_after_last_form } = req.body || {};
    
    // Логирование параметров запроса
    console.log(`[${requestTimestamp}] Request params:`, {
      action,
      session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
      has_user_message: !!user_message,
      has_prompt: !!prompt,
      locale
    });
    
    // Rate limiting для chat endpoint (после получения session_id)
    const rateLimitResult = await checkRateLimit(req);
    if (!rateLimitResult.allowed) {
      console.log(`[${requestTimestamp}] Rate limit exceeded for session:`, session_id ? `${session_id.substring(0, 10)}...` : 'unknown');
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Превышен лимит запросов. Попробуйте позже.',
        retryAfter: Math.ceil(rateLimitResult.resetTime / 1000)
      });
    }
    
    // Handle session initialization (first request with prompt)
    if (action === 'init' && prompt) {
      const initTimestamp = new Date().toISOString();
      console.log(`[${initTimestamp}] Session init request:`, {
        session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
        referer: req.headers.referer || req.headers.origin || 'not set',
        prompt_length: prompt ? prompt.length : 0,
        locale: locale || 'ru'
      });
      
      // Кэшируем промпт локально для быстрого доступа
      getCachedPrompt(prompt);
      
      const sessionData = { 
        prompt, 
        locale: locale || 'ru',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      // Сохраняем сессию в Redis сразу при инициализации
      try {
        const chatKey = `chat:${session_id}`;
        
        // Определяем источник из referer запроса
        const source = detectSource(req);
        console.log('🔍 Определен источник сессии:', source, 'referer:', req.headers.referer || req.headers.origin || 'не указан');
        
        // Проверяем, существует ли сессия в Redis
        const existingSession = await redis.get(chatKey);
        const sessionsListKey = source === 'nm-shop' ? 'sessions:list:nm-shop' : 'sessions:list:test';
        
        // Получаем page_url из body или referer
        const pageUrl = req.body.page_url || req.headers.referer || req.headers.origin || '';
        
        if (existingSession) {
          // Сессия уже существует - только обновляем prompt и locale, НЕ обновляем lastUpdated
          // чтобы не сдвигать дату последней активности при повторных инициализациях без сообщений
          existingSession.prompt = prompt;
          existingSession.locale = locale || 'ru';
          existingSession.source = existingSession.source || source; // Сохраняем источник если его нет
          // Сохраняем pageUrl если его нет или обновляем если есть новый
          if (!existingSession.pageUrl || pageUrl) {
            existingSession.pageUrl = pageUrl;
          }
          // lastUpdated не обновляем - сохраняем прежнее значение времени последнего действия
          await redis.setex(chatKey, 30 * 24 * 60 * 60, existingSession); // Обновляем TTL
          await redis.sadd(sessionsListKey, session_id); // Убеждаемся что сессия в списке
          console.log('Сессия обновлена в Redis:', session_id, 'источник:', existingSession.source, 'lastUpdated сохранен:', existingSession.lastUpdated);
        } else {
          // Новая сессия - создаем с пустыми сообщениями
          const redisSession = {
            sessionId: session_id,
            prompt,
            locale: locale || 'ru',
            source: source,
            pageUrl: pageUrl, // Сохраняем URL страницы
            createdAt: sessionData.createdAt,
            lastUpdated: sessionData.lastUpdated,
            messages: []
          };
          await redis.setex(chatKey, 30 * 24 * 60 * 60, redisSession); // TTL 30 дней
          const addedToSet = await redis.sadd(sessionsListKey, session_id); // Добавляем в список сессий
          // НЕ добавляем в индекс при init (пустая сессия) - добавим позже при появлении сообщений/контактов
          console.log('Новая сессия создана в Redis:', session_id, 'источник:', source, 'Добавлена в sessions:list:', addedToSet > 0);
        }
      } catch (error) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] Redis error in session init:`, {
          session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
          error_message: error.message,
          error_stack: error.stack ? error.stack.substring(0, 200) : 'no stack',
          referer: req.headers.referer || req.headers.origin || 'not set'
        });
        // Отключено для экономии Redis команд
        // trackError('redis_error', `Redis error in session init: ${error.message}`, req).catch(() => {});
        // Продолжаем работу даже если не удалось сохранить в Redis
      }
      
      console.log(`[${new Date().toISOString()}] Сессия инициализирована в Redis:`, session_id);
      
      return res.status(200).json({ status: 'initialized' });
    }
    
    // Handle chat requests
    if (action === 'chat' && session_id && user_message) {
      console.log('Обработка чата для сессии:', session_id);
      console.log('Сообщение пользователя:', user_message);
      let sessionHasContacts = false;
      
      // Всегда читаем сессию из Redis (не используем in-memory кэш)
      let session;
      try {
        const chatKey = `chat:${session_id}`;
        const redisSession = await redis.get(chatKey);
        
        if (!redisSession || !redisSession.prompt) {
          console.log('Сессия не найдена в Redis:', session_id);
          return res.status(400).json({ error: 'Session not initialized. Please reload the page.' });
        }
        
        // Используем промпт из Redis, с локальным кэшированием для производительности
        const cachedPrompt = getCachedPrompt(redisSession.prompt);
        
        // Проверяем телефон в текущем сообщении пользователя
        // Если телефон найден в текущем сообщении - сразу считаем что контакты есть
        const phoneInCurrentMessage = parsePhoneFromMessage(user_message);
        if (phoneInCurrentMessage) {
          console.log('📱 Телефон найден в текущем сообщении:', phoneInCurrentMessage);
          sessionHasContacts = true;
        } else {
          // Проверяем телефон в сохраненной сессии
          sessionHasContacts = Boolean(redisSession?.contacts?.phone && String(redisSession.contacts.phone).trim()) || Boolean(redisSession?.chatPhoneCaptured);
        }
        
        session = {
          prompt: cachedPrompt,
          locale: redisSession.locale || 'ru',
          createdAt: redisSession.createdAt || new Date().toISOString(),
          lastUpdated: redisSession.lastUpdated || new Date().toISOString()
        };
        
        console.log('Сессия загружена из Redis:', session_id);
      } catch (error) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] Redis error loading session:`, {
          session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
          error_message: error.message,
          error_stack: error.stack ? error.stack.substring(0, 200) : 'no stack',
          referer: req.headers.referer || req.headers.origin || 'not set'
        });
        // Отключено для экономии Redis команд
        // trackError('redis_error', `Redis error loading session: ${error.message}`, req).catch(() => {});
        return res.status(400).json({ error: 'Session not initialized. Please reload the page.' });
      }
      
      console.log('Сессия найдена:', !!session);
      
      // Build messages from history_tail + current message
      const messages = [
        ...(history_tail || []),
        { role: 'user', content: user_message }
      ];
      
      // Проверить историю сообщений на наличие телефонов
      if (!sessionHasContacts) {
        const hasPhoneInHistory = messages
          .filter(m => m.role === 'user')
          .some(m => parsePhoneFromMessage(m.content));
        if (hasPhoneInHistory) {
          sessionHasContacts = true;
          console.log('📱 Телефон найден в истории сообщений, устанавливаем sessionHasContacts = true');
        }
      }
      
      // ЭТАП 1: Анализируем сообщение пользователя
      let messageAnalysis;
      try {
        messageAnalysis = await analyzeUserMessage(user_message);
      } catch (error) {
        console.error('Ошибка анализа сообщения:', error);
        // Fallback - считаем что это FAQ вопрос
        messageAnalysis = { isProductQuestion: false, detectedCategory: null };
      }
      
      console.log('📊 Анализ сообщения:', messageAnalysis);
      
      // Строим системный промпт без каталога
      const sys = buildSystemPrompt(session.prompt, session.locale, aggressive_mode, sessionHasContacts);
      console.log('Системный промпт готов, длина:', sys.length);
      
      // Dev fallback: if no API key, return a mock reply so the widget works locally
      if (!process.env.OPENAI_API_KEY){
        console.log('Нет API ключа OpenAI, возвращаем mock ответ');
        const lastUser = (Array.isArray(messages)?messages:[]).filter(m=>m.role==='user').slice(-1)[0]?.content || '';
        const mock = lastUser
          ? `Понял ваш запрос: «${lastUser.slice(0, 140)}». Я консультант по диванам. Расскажите, какой диван вас интересует?`
          : 'Здравствуйте! Я консультант по диванам. Помогу подобрать идеальный диван для вашего дома. Какой диван вас интересует?';
        return res.status(200).json({ reply: mock });
      }
      
      // Проверяем Circuit Breaker
      if (isCircuitOpen()) {
        console.log('Circuit breaker: OpenAI API недоступен, используем fallback');
        const fallbackText = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
        return res.status(200).json({ reply: fallbackText, needsForm: true, formType: 'gift', circuitBreaker: true });
      }
      
      console.log('Отправляем запрос к OpenAI...');
      const model = 'gpt-5-mini';
      const body = {
        model,
        messages: [{ role:'system', content: sys }, ...(Array.isArray(messages)?messages:[])].slice(-24),
        max_completion_tokens: 800,     // Ограничение длины ответа (для gpt-5-mini)
        reasoning_effort: 'low',        // Уровень рассуждений для ускорения
        verbosity: 'low'                // Краткие ответы для ускорения
      };
      // Функция для retry запросов с таймаутом
      async function fetchWithRetry(url, options, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 секунд таймаут (изначальное значение)
            
            const response = await fetch(url, {
              ...options,
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response;
          } catch (error) {
            console.log(`OpenAI retry ${i + 1}/${maxRetries}:`, error.name);
            
            if (i === maxRetries - 1) throw error;
            // Retry стратегия: 1s, 2s (даем OpenAI время)
            const delay = 1000 * (i + 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      const requestStartTime = Date.now();
      let r;
      try {
        r = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
          method:'POST',
          headers:{
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
      } catch (error) {
        // Обработка ошибок после всех retry попыток
        console.error('❌ Все retry попытки исчерпаны:', error.message);
        // Отключено для экономии Redis команд
        // trackError('api_error', `OpenAI API request failed: ${error.message}`, req, { status: 'network_error' }).catch(() => {});
        throw error;
      }
      
      const requestLatency = Date.now() - requestStartTime;
      
      // Отслеживаем медленные запросы (>10 секунд)
      // Отключено для экономии Redis команд
      // if (requestLatency > 10000) {
      //   trackError('slow_request', `OpenAI API request took ${requestLatency}ms`, req, { latency: requestLatency }).catch(() => {});
      // }
      
      console.log('Ответ от OpenAI, статус:', r.status);
      
      if (!r.ok){
        // Обновляем Circuit Breaker при ошибке
        circuitBreaker.failures++;
        circuitBreaker.lastFailureTime = Date.now();
        
        if (circuitBreaker.failures >= circuitBreaker.threshold) {
          circuitBreaker.state = 'open';
          console.log('Circuit breaker: переход в open состояние');
        }
        
        const t = await r.text();
        const reason = (t || '').slice(0, 500);
        console.error('Ошибка OpenAI API:', r.status, reason);
        
        // Отслеживаем ошибки OpenAI API
        // Отключено для экономии Redis команд
        // trackError('api_error', `OpenAI API error: ${r.status} - ${reason}`, req, { status: r.status }).catch(() => {});
        
        // Более дружелюбный fallback
        const fallbackText = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
        return res.status(200).json({ reply: fallbackText, needsForm: true, formType: 'gift', debug: { status: r.status, modelTried: model, reason } });
      }
      
      // Сброс Circuit Breaker при успешном запросе
      if (circuitBreaker.state === 'half-open') {
        circuitBreaker.state = 'closed';
        circuitBreaker.failures = 0;
        console.log('Circuit breaker: переход в closed состояние');
      }
      
      const data = await r.json();
      // Безопасный лог сырого ответа (обрезка до 3000 символов)
      try {
        const rawPreview = JSON.stringify(data);
        console.log('RAW OPENAI (truncated):', rawPreview.length > 3000 ? rawPreview.slice(0, 3000) + '...<trimmed>' : rawPreview);
      } catch (err) {
        console.log('RAW OPENAI: <unable to stringify>', err?.message);
      }
      const choice = data?.choices?.[0] || {};
      const message = choice?.message || {};
      const finishReason = choice?.finish_reason;
      console.log('Получен ответ от OpenAI, choices:', data.choices?.length, 'finish_reason:', finishReason, 'has_refusal:', Boolean(message.refusal), 'content_type:', Array.isArray(message.content) ? 'array' : typeof message.content);
      
      // Нормализуем контент: OpenAI может вернуть строку или массив частей
      let reply = '';
      if (typeof message.content === 'string') {
        reply = message.content;
      } else if (Array.isArray(message.content)) {
        reply = message.content
          .map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
            return '';
          })
          .join('')
          .trim();
      }
      
      // Явный отказ/пустой ответ от модели — показываем мягкий fallback, а не «техническую ошибку»
      const gotRefusal = Boolean(message.refusal);
      if ((!reply || !reply.trim()) && gotRefusal) {
        reply = 'Не могу ответить на это корректно. Могу уточнить вопрос про доставку, оплату или товары и помочь, либо передать контакт менеджеру. Что удобнее?';
      }
      
      // Если ответ пустой или оборван по длине — даем безопасный ответ по доставке или общий
      const isDeliveryQuestion = /доставк|доставка/i.test(user_message || '');
      if ((!reply || !reply.trim()) || finishReason === 'length') {
        reply = isDeliveryQuestion
          ? 'Доставляем по всей Беларуси. Уточните город и что именно нужно — скажу срок и стоимость. По Минску и области доставляем курьером; в другие города отправляем транспортными службами. Заказ от 2700 BYN — доставка бесплатна. Напишите город и модель, уточню детали.'
          : 'Могу помочь по доставке, оплате или товарам. Напишите, что именно нужно, или оставьте телефон — менеджер перезвонит в течение 2 часов.';
      }
      
      console.log('Ответ бота (первые 100 символов):', reply.substring(0, 100));
      
      // Ограничиваем длину ответа до 800 символов с умной обрезкой
      if (reply.length > 800) {
        // Обрезаем по последней точке перед лимитом
        const truncated = reply.substring(0, 800);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastNewline = truncated.lastIndexOf('\n');
        
        // Берем позицию последней точки или переноса строки
        const cutPosition = Math.max(lastPeriod, lastNewline);
        
        if (cutPosition > 600) {
          // Если есть хорошая точка обрезки (не слишком рано)
          reply = truncated.substring(0, cutPosition + 1);
        } else {
          // Если нет - обрезаем жестко но добавляем троеточие
          reply = truncated + '...';
        }
      }
      
      // Принудительное форматирование - каждое предложение с новой строки
      reply = reply
        .replace(/\. /g, '.\n')  // Точка + пробел = точка + перенос строки
        .replace(/— /g, '—\n')  // Тире + пробел = тире + перенос строки
        .replace(/; /g, ';\n')  // Точка с запятой + пробел = перенос строки
        .replace(/\n\n+/g, '\n\n')  // Убираем лишние переносы
        .trim();
      
      // Fallback для пустого ответа от OpenAI
      let emptyReplyFallback = false;
      if (!reply || !reply.trim()) {
        reply = 'Похоже, сбой в системе. Напишите, что именно хотите уточнить по доставке, оплате или товарам — отвечу сразу. Если удобнее, оставьте телефон, и менеджер свяжется в течение 2 часов.';
        emptyReplyFallback = true;
      }
      
      // Проверяем, нужно ли показать форму (без дополнительного сообщения)
      let shouldGenerateFormMessage = checkIfNeedsFormMessage(reply, messages, user_messages_after_last_form);
      if (sessionHasContacts) {
        shouldGenerateFormMessage = false;
      }
      
      // При пустом ответе от OpenAI всегда показываем форму
      if (emptyReplyFallback) {
        shouldGenerateFormMessage = true;
      }
      
      // Сохраняем диалог в Redis (с ожиданием завершения)
      console.log('📝 Вызываем saveChat для сессии:', session_id);
      try {
        await saveChat(session_id, user_message, reply);
        console.log('✅ saveChat успешно завершен для:', session_id);
      } catch (error) {
        console.error('❌ Ошибка сохранения диалога:', error);
        console.error('Stack trace:', error.stack);
        // Отключено для экономии Redis команд
        // trackError('redis_error', `Redis error in saveChat: ${error.message}`, req).catch(() => {});
      }
      
      return res.status(200).json({ 
        reply, 
        needsForm: shouldGenerateFormMessage,
        isProductQuestion: messageAnalysis.isProductQuestion,
        detectedCategory: messageAnalysis.detectedCategory,
        hasContacts: sessionHasContacts,
        emptyReplyFallback: emptyReplyFallback
      });
    }
    
    // No valid action found
    return res.status(400).json({ error: 'Invalid request format' });
  }catch(e){
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] CRITICAL ERROR in chat API:`, {
      error_message: e.message,
      error_name: e.name,
      error_stack: e.stack ? e.stack.substring(0, 500) : 'no stack',
      method: req.method,
      url: req.url,
      referer: req.headers.referer || req.headers.origin || 'not set',
      userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 100) : 'not set',
      body_preview: req.body ? JSON.stringify(req.body).substring(0, 200) : 'no body'
    });
    // Отключено для экономии Redis команд
    // trackError('api_error', `Critical error in chat API: ${e.message}`, req, { status: 'internal_error' }).catch(() => {});
    const fallbackText = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
    return res.status(200).json({ reply: fallbackText, needsForm: true, formType: 'gift' });
  } finally {
    // Очищаем глобальную переменную после обработки запроса
    global.currentRequest = null;
  }
}

// Проверяем, нужно ли генерировать персонализированное сообщение с формой
function checkIfNeedsFormMessage(reply, messages, userMessagesAfterLastForm = 0) {
  // Проверяем паузу между показами форм (минимум 3 реплики клиента)
  if (userMessagesAfterLastForm > 0 && userMessagesAfterLastForm < 3) {
    return false; // Не показываем форму слишком часто
  }
  
  // Специальная проверка на запрос записи в шоурум
  const showroomKeywords = ['шоурум', 'шоу-рум', 'шоуруме', 'записаться в шоурум', 'запись в шоурум', 'посмотреть в шоуруме', 'приехать в шоурум'];
  const hasShowroomRequest = showroomKeywords.some(keyword => reply.toLowerCase().includes(keyword));
  
  if (hasShowroomRequest) {
    return true; // Показываем форму записи в шоурум
  }
  
  const formTriggers = [
    /(скидк|запис|подушк|дизайн|консульт)/i,
    /(понравилось|беру|хочу такой|хочу этот)/i,
    /(цен|стоимост|бюджет|сколько стоит|дорог|дешев)/i,
    /(доставк|срок|когда|быстро|время)/i,
    /(сомнева|думаю|подозр|не уверен|колеблюсь)/i,
    /(посмотрю|ещё|друг|альтернатив|вариант)/i,
    /(подумаю|решу|определюсь|выберу)/i,
    /(телефон|номер|контакт|связаться|позвонить)/i,
    /(оставьте|оставить|записать|запись)/i,
    /(форма|заполните|заполнить|данные в форме)/i,
    /(закрепить|закрепления|акции)/i,
    /(диван|мебель|покупк|заказ|интересно|нравится|подходит|подойдет)/i,
    /(подарок|выберите|выбор|акция|спецпредложение)/i,
    /(оставите телефон|оставить телефон|дайте телефон|дайте номер)/i,
    /(спецпредложение|специальное предложение)/i,
    /(закреплю|закреплю за вами)/i,
    /(10%|скидка|специальная)/i
  ];
  
  return formTriggers.some(regex => regex.test(reply));
}

function buildSystemPrompt(prompt, locale, aggressiveMode = false, hasContacts = false){
  const base = prompt?.main_instructions ? prompt : null;
  
  let about = base ? [
    `Роль: ${prompt.role_and_task}`,
    `Цель: ${prompt.goal}`,
    `Инструкции: ${prompt.main_instructions.join(' ')}`,
    `О компании: ${prompt.about_company?.description||''}`,
    `Достижения компании: ${prompt.about_company?.achievements ? Object.values(prompt.about_company.achievements).join(', ') : ''}`,
    `Салоны: ${prompt.about_company?.showrooms ? JSON.stringify(prompt.about_company.showrooms) : 'Информация о салонах недоступна'}`,
    `Подарки по категориям: ${prompt.offers?.gifts_by_category ? JSON.stringify(prompt.offers.gifts_by_category) : 'Информация о подарках недоступна'}`,
    `Персонализированные ответы: ${prompt.personalized_responses ? `Принцип: ${prompt.personalized_responses.principle}. Ключевые фразы: ${prompt.personalized_responses.key_phrases?.join(', ') || ''}. Примеры: ${JSON.stringify(prompt.personalized_responses.examples || {})}. ${prompt.personalized_responses.usage || ''}` : ''}`,
    `Доставка и оплата: ${prompt.delivery_and_payment ? JSON.stringify(prompt.delivery_and_payment) : 'Информация о доставке недоступна'}`,
    `Стиль: ${prompt.templates_and_style||''}`
  ].join('\n') : 'Ты консультант. Отвечай кратко.';
  
  // Add aggressive behavior instructions
  if (aggressiveMode && !hasContacts) {
    about += '\n\nВАЖНО: Сейчас агрессивный режим (после 2-3 сообщений). Активно предлагай подарки и персональную подборку дизайнера. Ищи любой повод для сбора контактов. Будь более настойчивым в предложениях.';
  }
  
  // Add instructions about form alternative
  about += '\n\nРАБОТА С ФОРМОЙ:\n- При предложении формы ВСЕГДА упоминай альтернативу: "можно в форме, которую вышлю ниже, или просто напишите имя и телефон прямо в чат"\n- Форма показывается только в чате виджета, НЕ предлагай другие способы отправки формы\n- Если клиент не видит форму или предпочитает написать в чат - это нормально, принимай контакты прямо в чате';
  
  // Add instructions if client already provided contacts - ПОСЛЕ инструкций про форму
  if (hasContacts) {
    about += '\n\n🎯 РЕЖИМ КОНСУЛЬТАНТА (контакты уже получены):\nКлиент уже оставил контакты (заполнил форму или написал телефон в чате). Твоя основная цель выполнена. Теперь просто мягко консультируй по вопросам клиента - отвечай на вопросы о доставке, оплате, компании, салонах. Не предлагай форму, подарки или повторный сбор контактов. Просто помогай и консультируй по существу.';
  }
  
  // Add delivery and payment instructions
  about += '\n\nРАБОТА С ДОСТАВКОЙ И ОПЛАТОЙ:\n- При вопросах о доставке используй таблицы стоимости по типам товаров и регионам\n- Учитывай тип товара (диван, кресло, шкаф и т.д.) и локацию клиента (в пределах/за пределами 2й МКАД)\n- При заказе от 2700 BYN - бесплатная доставка\n- Для подвесного кресла "Кокон" используй отдельную таблицу по городам\n- При запросах о возврате/замене отправляй ссылку: https://nm-shop.by/zamena-i-vozvrat-tovara/\n- При вопросах о рассрочке показывай форму обратной связи с текстом "Консультация по рассрочке"\n- При вопросах о кастомизации мебели показывай форму с текстом "Согласование размеров и конструкции"\n- Если информации нет в справочнике - эскалируй на менеджера';
  
  // Add showrooms instructions
  about += '\n\nРАБОТА С САЛОНАМИ:\n- При вопросах о салонах в конкретном городе предоставляй точную информацию: адрес, телефон, время работы\n- Доступны салоны в Минске (2 салона), Витебске, Новополоцке, Бобруйске\n- При вопросах "где посмотреть мебель в [город]" - давай адрес и контакты ближайшего салона\n- ВАЖНО: Учитывай возможные опечатки в названиях городов (синск=минск, витебс=витебск и т.д.)';
  
  // Add typo handling instructions
  about += '\n\nОБРАБОТКА ОПЕЧАТОК В ГОРОДАХ:\n- При распознавании городов учитывай возможные опечатки\n- "синск", "синске", "синска", "синском" = Минск\n- "витебс", "витебсск" = Витебск\n- "новополоц", "новополоцск" = Новополоцк\n- "бобруйс", "бобруйсск" = Бобруйск\n- Если сомневаешься в городе - уточни, но предложи ближайший салон';
  
  // Add critical restrictions about not inventing functionality
  about += '\n\nКРИТИЧЕСКИ ВАЖНО - НЕ ВЫДУМЫВАЙ ФУНКЦИОНАЛ:\n- НЕ предлагай отправку формы на email - форма показывается ТОЛЬКО в чате виджета\n- НЕ генерируй несуществующие ссылки (например, "https://nm-shop.by/согласование-размеров" - такой ссылки НЕ существует)\n- Используй ТОЛЬКО реально существующие ссылки, которые указаны в промпте\n- Разрешенные ссылки: только https://nm-shop.by/zamena-i-vozvrat-tovara/ для возврата/замены товара\n- Если не уверен в ссылке - НЕ упоминай её';
  
  return [
    about,
    'Отвечай только по этому промпту. Если вопрос вне — мягко откажись.',
    'Задавай только 1 уточняющий вопрос за раз.',
    `Язык: ${locale||'ru'}`
  ].join('\n\n');
}
module.exports = handler;
