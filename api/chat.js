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

// Import catalog module
const catalogHandler = require('./catalog');

// Import rate limiter
const { checkRateLimit } = require('../utils/rate-limiter');

// Используем тот же Redis клиент что и для каталога
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Сохранение диалога в Redis
async function saveChat(sessionId, userMessage, botReply) {
  try {
    const chatKey = `chat:${sessionId}`;
    
    // Читаем существующую сессию
    let session = await redis.get(chatKey);
    if (!session) {
      session = {
        sessionId,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messages: []
      };
    }
    
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
    await redis.set(chatKey, session);
    console.log('Диалог сохранен в Redis для сессии:', sessionId);
    console.log('Ключ в Redis:', chatKey);
    console.log('Данные сессии:', JSON.stringify(session, null, 2));
    return true;
  } catch (error) {
    console.error('Ошибка сохранения диалога в Redis:', error);
    return false;
  }
}

async function handler(req, res){
  // Add CORS headers for external domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') return res.status(405).end();
  
  try{
    const { action, session_id, user_message, history_tail, prompt, catalog, locale, aggressive_mode, user_messages_after_last_form } = req.body || {};
    
    // Rate limiting для chat endpoint (после получения session_id)
    const rateLimitResult = await checkRateLimit(req);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Превышен лимит запросов. Попробуйте позже.',
        retryAfter: Math.ceil(rateLimitResult.resetTime / 1000)
      });
    }
    
    // Handle session initialization (first request with prompt/catalog)
    if (action === 'init' && prompt && catalog) {
      console.log(`[${new Date().toISOString()}] Инициализация сессии:`, session_id);
      
      // Очищаем кэш если он переполнен
      cleanupSessionCache();
      
      sessionCache.set(session_id, { 
        prompt, 
        catalog, 
        locale: locale || 'ru',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });
      
      console.log(`[${new Date().toISOString()}] Сессия инициализирована, размер кэша: ${sessionCache.size}`);
      
      return res.status(200).json({ status: 'initialized' });
    }
    
    // Handle chat requests
    if (action === 'chat' && session_id && user_message) {
      console.log('Обработка чата для сессии:', session_id);
      console.log('Сообщение пользователя:', user_message);
      
      const session = sessionCache.get(session_id);
      if (!session) {
        console.log('Сессия не найдена в кеше:', session_id);
        return res.status(400).json({ error: 'Session not initialized. Please reload the page.' });
      }
      
      console.log('Сессия найдена:', !!session);
      
      // Build messages from history_tail + current message
      const messages = [
        ...(history_tail || []),
        { role: 'user', content: user_message }
      ];
      
      // Get relevant products from catalog - direct integration
      let relevantProducts = '';
      let catalogAvailable = false;
      try {
        // Извлекаем предыдущие сообщения для контекста (без текущего)
        const historyMessages = messages.filter(m => m.role === 'user');
        let enrichedQuery;
        
        if (historyMessages.length > 1) {
          // Есть история - берем только предыдущие сообщения (не дублируем текущее)
          const previousMessages = historyMessages.slice(0, -1); // Все кроме последнего
          const historyText = previousMessages.map(m => m.content).join(' ');
          enrichedQuery = `${historyText} ${user_message}`;
          console.log('📝 Обогащенный запрос с историей (без дублей):', enrichedQuery.substring(0, 150));
        } else {
          // Первое сообщение - используем как есть
          enrichedQuery = user_message;
          console.log('🔍 Первый запрос - без обогащения:', enrichedQuery);
        }
        
        console.log('Начинаем работу с каталогом...');
        
        // Прямой вызов каталога без HTTP запроса
        const catalogHandler = require('./catalog');
        
        // Создаем mock request/response для каталога
        const catalogReq = {
          method: 'POST',
          body: {
            action: 'search',
            query: enrichedQuery, // Используем обогащенный запрос с историей
            filters: { limit: 20 }
          }
        };
        
        let catalogData = null;
        const catalogRes = {
          setHeader: () => {},
          status: (code) => ({
            json: (data) => {
              catalogData = data;
              console.log('📊 Прямые данные каталога:', {
                success: data.success,
                totalFound: data.totalFound,
                hasFormattedForGPT: !!data.formattedForGPT,
                formattedLength: data.formattedForGPT ? data.formattedForGPT.length : 0
              });
            },
            end: () => {}
          }),
          json: (data) => {
            catalogData = data;
            console.log('📊 Прямые данные каталога (200):', {
              success: data.success,
              totalFound: data.totalFound,
              hasFormattedForGPT: !!data.formattedForGPT,
              formattedLength: data.formattedForGPT ? data.formattedForGPT.length : 0
            });
          }
        };
        
        await catalogHandler(catalogReq, catalogRes);
        
        // Fallback: если с обогащением ничего не нашли - пробуем без истории
        if (catalogData && catalogData.success && catalogData.totalFound === 0 && enrichedQuery !== user_message) {
          console.log('⚠️ С обогащением не нашли товары, пробуем без истории...');
          catalogReq.body.query = user_message; // Только текущее сообщение
          catalogData = null; // Сброс
          await catalogHandler(catalogReq, catalogRes);
          
          if (catalogData && catalogData.success && catalogData.totalFound > 0) {
            console.log('✅ Без обогащения нашли товары:', catalogData.totalFound);
          }
        }
        
        if (catalogData && catalogData.success) {
          if (catalogData.totalFound > 0 && catalogData.formattedForGPT) {
            relevantProducts = catalogData.formattedForGPT;
            catalogAvailable = true;
            console.log('✅ Финально найдено товаров:', catalogData.totalFound);
          } else {
            // Товары не найдены по критериям - продолжаем работу
            console.log('⚠️ Товары не найдены по критериям, каталог работает');
            relevantProducts = 'ТОВАРЫ_НЕ_НАЙДЕНЫ';
            catalogAvailable = true; // Каталог работает, просто нет совпадений
          }
        } else {
          console.log('❌ Каталог недоступен или ошибка загрузки');
          relevantProducts = 'КАТАЛОГ_НЕДОСТУПЕН';
          catalogAvailable = false;
        }
      } catch (error) {
        console.error('❌ Ошибка получения каталога:', error);
        relevantProducts = 'КАТАЛОГ_ОШИБКА';
      }
      
      console.log('Строим системный промпт...');
      const sys = buildSystemPrompt(session.prompt, relevantProducts, session.locale, aggressive_mode);
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
      
      // Сохраняем диалог в Redis (не блокируем основной поток)
      saveChat(session_id, user_message, reply).catch(error => {
        console.error('Ошибка сохранения диалога (не критично):', error);
      });
      
      return res.status(200).json({ 
        reply, 
        formMessage,
        needsForm: shouldGenerateFormMessage 
      });
    }
    
    // No valid action found
    return res.status(400).json({ error: 'Invalid request format' });
  }catch(e){
    console.error('КРИТИЧЕСКАЯ ОШИБКА в API чата:', e);
    console.error('Стек ошибки:', e.stack);
    const fallbackText = 'Извините, система временно недоступна. Оставьте телефон и наш дизайнер перезвонит вам, а я закреплю за вами подарок 🎁';
    return res.status(200).json({ reply: fallbackText, needsForm: true, formType: 'gift' });
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

function buildSystemPrompt(prompt, relevantProducts, locale, aggressiveMode = false){
  const base = prompt?.main_instructions ? prompt : null;
  let about = base ? [
    `Роль: ${prompt.role_and_task}`,
    `Цель: ${prompt.goal}`,
    `Инструкции: ${prompt.main_instructions.join(' ')}`,
    `О компании: ${prompt.about_company?.description||''}`,
    `Достижения компании: ${prompt.about_company?.achievements ? Object.values(prompt.about_company.achievements).join(', ') : ''}`,
    `Салоны: ${prompt.about_company?.showrooms ? JSON.stringify(prompt.about_company.showrooms, null, 2) : 'Информация о салонах недоступна'}`,
    `Офферы: ${prompt.offers?.main_discount||''}; альтернативы: ${(prompt.offers?.alternative_offers||[]).join('; ')}`,
    `Доставка и оплата: ${prompt.delivery_and_payment ? JSON.stringify(prompt.delivery_and_payment, null, 2) : 'Информация о доставке недоступна'}`,
    `Стиль: ${prompt.templates_and_style||''}`
  ].join('\n') : 'Ты консультант. Отвечай кратко.';
  
  // Add aggressive behavior instructions
  if (aggressiveMode) {
    about += '\n\nВАЖНО: Сейчас агрессивный режим (после 2-3 сообщений). Активно предлагай скидки, консультации, записи в шоурум. Ищи любой повод для сбора контактов. Будь более настойчивым в предложениях.';
  }
  
  // Add strict offer rules
  about += '\n\nКРИТИЧЕСКИ ВАЖНО: Предлагай только ОДНУ акцию за раз. НЕ комбинируй скидки с подарками. При запросе товаров - внимательно проверяй каталог и предлагай только реально существующие модели.';
  
  // Add catalog limitation instruction
  about += '\n\nКАТАЛОГ: В каталоге есть полная информация о товарах включая цвета, механизмы, описания. При запросе товаров из каталога предлагай максимум 3 самых релевантных варианта. Не перегружай сообщение длинными списками. НЕ используй жирный шрифт (**текст**) - заменяй на обычный текст. При запросе по цвету/стилю - фильтруй каталог по критериям и предлагай только подходящие варианты.';
  
  // Add aggressive catalog usage instructions
  about += '\n\nВАЖНО ПРИ РАБОТЕ С КАТАЛОГОМ:\n- Из каталога показаны только релевантные товары - выбери 2-3 лучших\n- ВСЕГДА предлагай конкретные товары с названием, ценой и ссылкой\n- Если товаров мало - предложи все что есть\n- Если товаров 0 - предложи консультацию дизайнера для индивидуального подбора\n- При поиске товаров используй каталог агрессивно - ищи похожие категории, синонимы, смежные товары\n- КРИТИЧЕСКИ ВАЖНО: Если в каталоге 0 результатов - это ошибка поиска, попробуй другие термины или предложи дизайнера';
  
  // Add delivery and payment instructions
  about += '\n\nРАБОТА С ДОСТАВКОЙ И ОПЛАТОЙ:\n- При вопросах о доставке используй таблицы стоимости по типам товаров и регионам\n- Учитывай тип товара (диван, кресло, шкаф и т.д.) и локацию клиента (в пределах/за пределами 2й МКАД)\n- При заказе от 2700 BYN - бесплатная доставка\n- Для подвесного кресла "Кокон" используй отдельную таблицу по городам\n- При запросах о возврате/замене отправляй ссылку: https://nm-shop.by/zamena-i-vozvrat-tovara/\n- При вопросах о рассрочке показывай форму обратной связи с текстом "Консультация по рассрочке"\n- При вопросах о кастомизации мебели показывай форму с текстом "Согласование размеров и конструкции"\n- Если информации нет в справочнике - эскалируй на менеджера';
  
  // Add showrooms instructions
  about += '\n\nРАБОТА С САЛОНАМИ:\n- При вопросах о салонах в конкретном городе предоставляй точную информацию: адрес, телефон, время работы\n- Доступны салоны в Минске (2 салона), Витебске, Новополоцке, Бобруйске\n- При вопросах "где посмотреть мебель в [город]" - давай адрес и контакты ближайшего салона';
  
  let fence = '';
  if (relevantProducts === 'ТОВАРЫ_НЕ_НАЙДЕНЫ') {
    fence = 'ПО КРИТЕРИЯМ НЕ НАЙДЕНО: В каталоге есть товары, но не по этим критериям. Предложи:\n1. Расширить бюджет или изменить критерии\n2. Показать похожие варианты\n3. Консультацию дизайнера\nНЕ ГОВОРИ "в каталоге нет товаров" - они есть, просто не подходят по критериям!';
  } else if (relevantProducts === 'КАТАЛОГ_НЕДОСТУПЕН' || relevantProducts === 'КАТАЛОГ_ОШИБКА') {
    fence = 'КАТАЛОГ НЕДОСТУПЕН: Технические проблемы. Предложи консультацию дизайнера.';
  } else if (relevantProducts) {
    fence = `Товары из каталога:\n${relevantProducts}`;
  }
  
  return [
    about,
    'Отвечай только по каталогу и этому промпту. Если вопрос вне — мягко откажись.',
    'Задавай только 1 уточняющий вопрос за раз.',
    fence,
    `Язык: ${locale||'ru'}`
  ].join('\n\n');
}
module.exports = handler;