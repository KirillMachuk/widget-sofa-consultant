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
    await redis.set(chatKey, session);
    await redis.expire(chatKey, 30 * 24 * 60 * 60); // TTL 30 дней
    // Убеждаемся, что сессия добавлена в соответствующий список сессий
    await redis.sadd(sessionsListKey, sessionId);
    console.log('✅ redis.set выполнен, сессия добавлена в', sessionsListKey);
    
    // Убрана verification проверка для экономии Redis команд (GET после SET не нужен)
    
    console.log('Диалог сохранен в Redis для сессии:', sessionId, 'источник:', source);
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
        
        if (existingSession) {
          // Сессия уже существует - только обновляем prompt и lastUpdated
          existingSession.prompt = prompt;
          existingSession.locale = locale || 'ru';
          existingSession.source = existingSession.source || source; // Сохраняем источник если его нет
          existingSession.lastUpdated = sessionData.lastUpdated;
          await redis.set(chatKey, existingSession);
          await redis.expire(chatKey, 30 * 24 * 60 * 60); // Обновляем TTL
          await redis.sadd(sessionsListKey, session_id); // Убеждаемся что сессия в списке
          console.log('Сессия обновлена в Redis:', session_id, 'источник:', existingSession.source);
        } else {
          // Новая сессия - создаем с пустыми сообщениями
          const redisSession = {
            sessionId: session_id,
            prompt,
            locale: locale || 'ru',
            source: source,
            createdAt: sessionData.createdAt,
            lastUpdated: sessionData.lastUpdated,
            messages: []
          };
          await redis.set(chatKey, redisSession);
          await redis.expire(chatKey, 30 * 24 * 60 * 60); // TTL 30 дней
          const addedToSet = await redis.sadd(sessionsListKey, session_id); // Добавляем в список сессий
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
      const sys = buildSystemPrompt(session.prompt, session.locale, aggressive_mode);
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
        max_completion_tokens: 600,     // Ограничение длины ответа
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
      console.log('Получен ответ от OpenAI, choices:', data.choices?.length);
      
      let reply = data.choices?.[0]?.message?.content || '';
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
      
      // Проверяем, нужно ли показать форму (без дополнительного сообщения)
      const shouldGenerateFormMessage = checkIfNeedsFormMessage(reply, messages, user_messages_after_last_form);
      
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
        detectedCategory: messageAnalysis.detectedCategory
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

// Генерируем персонализированное сообщение с формой
async function generatePersonalizedFormMessage(messages, session) {
  try {
    // Проверяем, есть ли запрос на шоурум
    const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    const showroomKeywords = ['шоурум', 'шоу-рум', 'шоуруме', 'записаться в шоурум', 'запись в шоурум', 'посмотреть в шоуруме', 'приехать в шоурум'];
    const hasShowroomRequest = showroomKeywords.some(keyword => lastUserMessage.toLowerCase().includes(keyword));
    
    if (hasShowroomRequest) {
      // Возвращаем специальное сообщение для шоурума
      return 'Подскажите пожалуйста в каком городе находитесь и ваш номер телефона, передам дизайнеру в шоу-руме и он с вами свяжется';
    }
    
    const systemPrompt = `Ты консультант по диванам. Сгенерируй персонализированное сообщение для предложения формы с подарком.

КОНТЕКСТ ДИАЛОГА:
${messages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}

ТРЕБОВАНИЯ:
- Сообщение должно быть персонализировано под запрос клиента
- Упомяни конкретные детали из диалога (модель дивана, цвет, размер и т.д.)
- ОБЯЗАТЕЛЬНО предложи выбор между "10% скидкой" или "2 декоративными подушками"
- НЕ предлагай только один вариант - всегда оба варианта
- Сообщение должно быть естественным и логичным продолжением диалога
- Максимум 2-3 предложения
- Используй фразы: "закреплю", "подарок", "выберите", "форма"

ПРИМЕРЫ:
- "Отлично! Диван 'Осло' в сером цвете - отличный выбор. Могу закрепить для вас подарок — выберите 10% скидку или 2 декоративные подушки в цвет дивана. Заполните форму для закрепления выбранной акции."
- "Понял, вам нужен диван для гостиной. Могу закрепить специальное предложение — выберите 10% скидку или 2 декоративные подушки. Заполните форму для получения подарка."
- "Диван для спальни - отличная идея. Могу закрепить для вас подарок — выберите 10% скидку или 2 декоративные подушки. Заполните форму для закрепления выбранной акции."

ВАЖНО: Всегда предлагай ВЫБОР между двумя вариантами, никогда не предлагай только один вариант!

Сгенерируй персонализированное сообщение:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [{ role: 'system', content: systemPrompt }],
        max_completion_tokens: 150,     // Ограничение длины ответа
        reasoning_effort: 'low',        // Быстрая генерация стандартного сообщения
        verbosity: 'low'                // Краткое сообщение о подарках
      })
    });

    if (response.ok) {
      const data = await response.json();
      const generatedMessage = data.choices?.[0]?.message?.content || '';
      
      // Проверяем, что сообщение содержит оба варианта подарков
      const hasDiscount = /10%|скидк/i.test(generatedMessage);
      const hasPillows = /подушк|2 декоративн/i.test(generatedMessage);
      const hasChoice = /выберите|или/i.test(generatedMessage);
      
      // Если не содержит оба варианта, возвращаем стандартное сообщение
      if (!hasDiscount || !hasPillows || !hasChoice) {
        return 'Могу закрепить для вас подарок — выберите 10% скидку или 2 декоративные подушки в цвет дивана. Заполните форму для закрепления выбранной акции.';
      }
      
      return generatedMessage;
    }
  } catch (error) {
  }
  
  return null;
}

function buildSystemPrompt(prompt, locale, aggressiveMode = false){
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
  if (aggressiveMode) {
    about += '\n\nВАЖНО: Сейчас агрессивный режим (после 2-3 сообщений). Активно предлагай подарки и персональную подборку дизайнера. Ищи любой повод для сбора контактов. Будь более настойчивым в предложениях.';
  }
  
  // Add delivery and payment instructions
  about += '\n\nРАБОТА С ДОСТАВКОЙ И ОПЛАТОЙ:\n- При вопросах о доставке используй таблицы стоимости по типам товаров и регионам\n- Учитывай тип товара (диван, кресло, шкаф и т.д.) и локацию клиента (в пределах/за пределами 2й МКАД)\n- При заказе от 2700 BYN - бесплатная доставка\n- Для подвесного кресла "Кокон" используй отдельную таблицу по городам\n- При запросах о возврате/замене отправляй ссылку: https://nm-shop.by/zamena-i-vozvrat-tovara/\n- При вопросах о рассрочке показывай форму обратной связи с текстом "Консультация по рассрочке"\n- При вопросах о кастомизации мебели показывай форму с текстом "Согласование размеров и конструкции"\n- Если информации нет в справочнике - эскалируй на менеджера';
  
  // Add showrooms instructions
  about += '\n\nРАБОТА С САЛОНАМИ:\n- При вопросах о салонах в конкретном городе предоставляй точную информацию: адрес, телефон, время работы\n- Доступны салоны в Минске (2 салона), Витебске, Новополоцке, Бобруйске\n- При вопросах "где посмотреть мебель в [город]" - давай адрес и контакты ближайшего салона\n- ВАЖНО: Учитывай возможные опечатки в названиях городов (синск=минск, витебс=витебск и т.д.)';
  
  // Add typo handling instructions
  about += '\n\nОБРАБОТКА ОПЕЧАТОК В ГОРОДАХ:\n- При распознавании городов учитывай возможные опечатки\n- "синск", "синске", "синска", "синском" = Минск\n- "витебс", "витебсск" = Витебск\n- "новополоц", "новополоцск" = Новополоцк\n- "бобруйс", "бобруйсск" = Бобруйск\n- Если сомневаешься в городе - уточни, но предложи ближайший салон';
  
  return [
    about,
    'Отвечай только по этому промпту. Если вопрос вне — мягко откажись.',
    'Задавай только 1 уточняющий вопрос за раз.',
    `Язык: ${locale||'ru'}`
  ].join('\n\n');
}
module.exports = handler;
