// Simple in-memory cache for sessions with size limit
const sessionCache = new Map();
const MAX_SESSION_CACHE_SIZE = 100; // Ограничиваем размер кэша

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

// Очистка старых сессий из кэша
function cleanupSessionCache() {
  if (sessionCache.size > MAX_SESSION_CACHE_SIZE) {
    const entries = Array.from(sessionCache.entries());
    // Сортируем по времени последнего обновления
    entries.sort((a, b) => {
      const timeA = new Date(a[1].lastUpdated || a[1].createdAt || 0).getTime();
      const timeB = new Date(b[1].lastUpdated || b[1].createdAt || 0).getTime();
      return timeA - timeB;
    });
    
    // Удаляем самые старые сессии
    const toDelete = entries.slice(0, sessionCache.size - MAX_SESSION_CACHE_SIZE);
    toDelete.forEach(([key]) => sessionCache.delete(key));
    console.log(`Очищено ${toDelete.length} старых сессий из кэша`);
  }
}

// Import rate limiter
const { checkRateLimit } = require('../utils/rate-limiter');

// Используем единый Redis клиент с retry логикой (Yandex Managed Redis)
const redis = require('../utils/redis-client');

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
      session = {
        sessionId,
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
    
    // Сохраняем в Redis
    console.log('🔧 ПЕРЕД redis.set: messages.length =', session.messages.length);
    await redis.set(chatKey, session);
    await redis.expire(chatKey, 30 * 24 * 60 * 60); // TTL 30 дней
    console.log('✅ redis.set выполнен');
    
    // ПРОВЕРКА: читаем сразу после записи
    const verification = await redis.get(chatKey);
    console.log('🔍 ПРОВЕРКА сразу после SET:');
    console.log('  - messages type:', typeof verification.messages);
    console.log('  - messages isArray:', Array.isArray(verification.messages));
    console.log('  - messages.length:', verification.messages ? verification.messages.length : 'undefined');
    
    console.log('Диалог сохранен в Redis для сессии:', sessionId);
    console.log('Ключ в Redis:', chatKey);
    console.log('Данные сессии:', JSON.stringify(session, null, 2));
    return true;
  } catch (error) {
    console.error('Ошибка сохранения диалога в Redis:', error);
    return false;
  }
}

// Определение типа вопроса и категории товара
async function analyzeUserMessage(userMessage) {
  const analysisPrompt = `Ты анализируешь запросы клиентов мебельного магазина nm-shop.by.

ЗАДАЧА: Определить тип вопроса и категорию товара (если есть).

ЗАПРОС КЛИЕНТА: ${JSON.stringify(userMessage)}

ПРАВИЛА:
1. Если клиент спрашивает о конкретных товарах (диван, стул, кровать, кухня) → isProductQuestion: true
2. Если клиент спрашивает о салонах, доставке, оплате, гарантии, контактах → isProductQuestion: false
3. Определи категорию из вопроса:
   - "диван", "софа", "угловой диван" → detectedCategory: "Диван"
   - "кровать", "спальное место", "матрас" → detectedCategory: "Кровать"
   - "кухня", "кухонный гарнитур", "кухонная мебель" → detectedCategory: "Кухня"
   - "стол", "стул", "шкаф", "прихожая" → detectedCategory: "Другое"
   - Нет упоминания категории → detectedCategory: null

ПРИМЕРЫ:

Запрос: "нужен стул до 300 руб"
Ответ: {"isProductQuestion": true, "detectedCategory": "Другое"}

Запрос: "какие у вас диваны?"
Ответ: {"isProductQuestion": true, "detectedCategory": "Диван"}

Запрос: "где можно диваны посмотреть в минске"
Ответ: {"isProductQuestion": false, "detectedCategory": null}

Запрос: "какие условия доставки"
Ответ: {"isProductQuestion": false, "detectedCategory": null}

Запрос: "подберите кровать с подъемным механизмом"
Ответ: {"isProductQuestion": true, "detectedCategory": "Кровать"}

ВАЖНО: Отвечай СТРОГО валидным JSON объектом, ничего больше:
{"isProductQuestion": true/false, "detectedCategory": "Диван"/"Кровать"/"Кухня"/"Другое"/null}`;

  console.log('🔍 Message Analysis: промпт длина:', analysisPrompt.length, 'символов');
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: analysisPrompt }],
        max_tokens: 100,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Message Analysis: OpenAI error', response.status);
      console.error('Message Analysis: Error details:', errorText);
      // Fallback: считаем что это FAQ вопрос без категории
      return { isProductQuestion: false, detectedCategory: null };
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content || '{}';
    
    console.log('🔍 Message Analysis extracted content:', resultText);
    
    // Парсим JSON с обработкой ошибок
    try {
      const result = JSON.parse(resultText);
      console.log('🔍 Message Analysis parsed:', result);
      return result;
    } catch (parseError) {
      console.error('❌ Message Analysis: JSON parse error', resultText);
      return { isProductQuestion: false, detectedCategory: null };
    }
  } catch (error) {
    console.error('Message Analysis: request error', error);
    // Fallback: при ошибке сети считаем что это FAQ вопрос
    return { isProductQuestion: false, detectedCategory: null };
  }
}

// Express handler для локальной разработки
async function handler(req, res){
  // Делаем текущий запрос доступным в глобальной области (например, для saveChat)
  global.currentRequest = req;
  
  // Логирование всех входящих запросов
  const requestTimestamp = new Date().toISOString();
  console.log(`[${requestTimestamp}] Incoming request:`, {
    method: req.method,
    url: req.url,
    referer: req.headers.referer || req.headers.origin || 'not set',
    userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 120) : 'not set'
  });
  
  // Add CORS headers for external domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    console.log(`[${requestTimestamp}] Method not allowed:`, req.method);
    return res.status(405).end();
  }
  
  try{
    const { action, session_id, user_message, history_tail, prompt, locale, aggressive_mode, user_messages_after_last_form } = req.body || {};
    
    console.log(`[${requestTimestamp}] Request params:`, {
      action,
      session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
      has_user_message: Boolean(user_message),
      has_prompt: Boolean(prompt),
      locale: locale || 'ru'
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
        prompt_length: prompt.length,
        locale: locale || 'ru'
      });
      
      // Очищаем кэш только если он переполнен
      cleanupSessionCache();
      
      const sessionData = { 
        prompt, 
        locale: locale || 'ru',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      sessionCache.set(session_id, sessionData);
      
      // Сохраняем сессию в Redis сразу при инициализации
      try {
        const chatKey = `chat:${session_id}`;
        
        // Проверяем, существует ли сессия в Redis
        const existingSession = await redis.get(chatKey);
        
        if (existingSession) {
          // Сессия уже существует - только обновляем prompt и lastUpdated
          existingSession.prompt = prompt;
          existingSession.locale = locale || 'ru';
          existingSession.lastUpdated = sessionData.lastUpdated;
          await redis.set(chatKey, existingSession);
          await redis.expire(chatKey, 30 * 24 * 60 * 60); // Обновляем TTL
          await redis.sadd('sessions:list', session_id); // Убеждаемся что сессия в списке
          console.log('Сессия обновлена в Redis:', session_id);
        } else {
          // Новая сессия - создаем с пустыми сообщениями
          const redisSession = {
            sessionId: session_id,
            prompt,
            locale: locale || 'ru',
            createdAt: sessionData.createdAt,
            lastUpdated: sessionData.lastUpdated,
            messages: []
          };
          await redis.set(chatKey, redisSession);
          await redis.expire(chatKey, 30 * 24 * 60 * 60); // TTL 30 дней
          await redis.sadd('sessions:list', session_id); // Добавляем в список сессий
          console.log('Новая сессия создана в Redis:', session_id);
        }
      } catch (error) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] Redis error in session init:`, {
          session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
          error_message: error.message,
          error_stack: error.stack ? error.stack.substring(0, 200) : 'no stack',
          referer: req.headers.referer || req.headers.origin || 'not set'
        });
        // Продолжаем работу даже если не удалось сохранить в Redis
      }
      
      console.log(`[${new Date().toISOString()}] Сессия инициализирована, размер кэша: ${sessionCache.size}`);
      
      return res.status(200).json({ status: 'initialized' });
    }
    
    // Handle chat requests
    if (action === 'chat' && session_id && user_message) {
      console.log('Обработка чата для сессии:', session_id);
      console.log('Сообщение пользователя:', user_message);
      
      const session = sessionCache.get(session_id);
      if (!session) {
        console.log(`[${requestTimestamp}] Сессия не найдена в кеше:`, session_id);
        return res.status(400).json({ error: 'Session not initialized. Please reload the page.' });
      }
      
      // Обновляем время последнего использования сессии
      session.lastUpdated = new Date().toISOString();
      sessionCache.set(session_id, session);
      
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
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] Ошибка анализа сообщения:`, {
          session_id: session_id ? `${session_id.substring(0, 10)}...` : 'not set',
          error_message: error.message,
          error_stack: error.stack ? error.stack.substring(0, 200) : 'no stack'
        });
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
        messages: [{ role:'system', content: sys }, ...(Array.isArray(messages)?messages:[])].slice(-24)
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
        throw error;
      }
      
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
      
      // Проверяем, нужно ли генерировать персонализированное сообщение с формой
      const shouldGenerateFormMessage = checkIfNeedsFormMessage(reply, messages, user_messages_after_last_form);
      let formMessage = null;
      
      if (shouldGenerateFormMessage) {
        formMessage = await generatePersonalizedFormMessage(messages, session);
      }
      
      // Сохраняем диалог в Redis (с ожиданием завершения)
      console.log('📝 Вызываем saveChat для сессии:', session_id);
      try {
        await saveChat(session_id, user_message, reply);
        console.log('✅ saveChat успешно завершен для:', session_id);
      } catch (error) {
        console.error('❌ Ошибка сохранения диалога:', error);
        console.error('Stack trace:', error.stack);
      }
      
      return res.status(200).json({ 
        reply, 
        formMessage,
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
      userAgent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 120) : 'not set',
      body_preview: req.body ? JSON.stringify(req.body).substring(0, 200) : 'no body'
    });
    const fallbackText = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
    return res.status(200).json({ reply: fallbackText, needsForm: true, formType: 'gift' });
  } finally {
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
        max_tokens: 150,
        temperature: 0.3
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
    `Салоны: ${prompt.about_company?.showrooms ? JSON.stringify(prompt.about_company.showrooms, null, 2) : 'Информация о салонах недоступна'}`,
    `Подарки по категориям: ${prompt.offers?.gifts_by_category ? JSON.stringify(prompt.offers.gifts_by_category, null, 2) : 'Информация о подарках недоступна'}`,
    `Доставка и оплата: ${prompt.delivery_and_payment ? JSON.stringify(prompt.delivery_and_payment, null, 2) : 'Информация о доставке недоступна'}`,
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

// Export для Express (локальная разработка)
module.exports = handler;

// Export для Yandex Cloud Functions (production)
module.exports.cloudHandler = async (event, context) => {
  // Адаптация Yandex Cloud Functions event в Express req/res формат
  const req = {
    method: event.httpMethod || 'POST',
    body: typeof event.body === 'string' ? JSON.parse(event.body) : event.body,
    headers: event.headers || {},
    url: event.url || '/api/chat'
  };
  
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader: function(name, value) {
      this.headers[name] = value;
    },
    status: function(code) {
      this.statusCode = code;
      return {
        json: (data) => {
          this.body = JSON.stringify(data);
          return this;
        },
        end: () => {
          this.body = '';
          return this;
        }
      };
    },
    json: function(data) {
      this.body = JSON.stringify(data);
      return this;
    },
    end: function() {
      this.body = '';
      return this;
    }
  };
  
  try {
    await handler(req, res);
    
    return {
      statusCode: res.statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...res.headers
      },
      body: res.body
    };
  } catch (error) {
    console.error('Cloud handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

