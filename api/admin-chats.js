// Используем новый Redis клиент с retry логикой
const redisClient = require('../utils/redis-client');

// Читаем все чаты из Redis используя список сессий из SET
async function readChats(source = 'test', limit = 100, offset = 0) {
  try {
    console.log('🔍 Получаем список сессий из Redis SET для источника:', source);
    
    // ДИАГНОСТИКА: Проверяем оба источника для понимания распределения сессий
    try {
      const testSessionsCount = await redisClient.scard('sessions:list:test');
      const nmShopSessionsCount = await redisClient.scard('sessions:list:nm-shop');
      console.log(`📊 Диагностика источников: test=${testSessionsCount || 0}, nm-shop=${nmShopSessionsCount || 0}`);
    } catch (diagError) {
      console.warn('⚠️ Не удалось получить диагностику источников:', diagError.message);
    }
    
    // Используем разные ключи для разных источников
    const sessionsListKey = source === 'nm-shop' ? 'sessions:list:nm-shop' : 'sessions:list:test';
    
    // Получаем список ID сессий из Redis SET
    let sessionIds = await redisClient.smembers(sessionsListKey);
    console.log(`Найдено ID сессий в SET (${sessionsListKey}): ${sessionIds ? sessionIds.length : 0}`);
    
    // Если SET пустой, пытаемся использовать старый sessions:list или KEYS как fallback (миграция)
    if (!sessionIds || sessionIds.length === 0) {
      console.log('SET пустой, пытаемся использовать старый sessions:list...');
      try {
        // Пробуем старый ключ sessions:list
        sessionIds = await redisClient.smembers('sessions:list');
        if (sessionIds && sessionIds.length > 0) {
          console.log(`Найдено сессий в старом sessions:list: ${sessionIds.length}`);
          // Мигрируем в новый ключ
          if (source === 'test') {
            redisClient.sadd(sessionsListKey, ...sessionIds).catch(err => {
              console.warn('Не удалось мигрировать в новый SET:', err.message);
            });
          }
        } else {
          // Если и старый пустой, пробуем KEYS
          console.log('Старый SET тоже пустой, пытаемся получить ключи через KEYS...');
          const keys = await redisClient.keys('chat:*');
          if (keys && keys.length > 0) {
            console.log(`Найдено ключей через KEYS: ${keys.length}`);
            // Извлекаем session IDs из ключей
            sessionIds = keys.map(key => key.replace('chat:', ''));
            // Попытка заполнить SET (не блокируем если не получится)
            if (sessionIds.length > 0) {
              redisClient.sadd(sessionsListKey, ...sessionIds).catch(err => {
                console.warn('Не удалось заполнить SET:', err.message);
              });
            }
          }
        }
      } catch (error) {
        console.error('Ошибка при fallback:', error.message);
        return { sessions: [], total: 0 };
      }
    }
    
    if (!sessionIds || sessionIds.length === 0) {
      console.log('Нет сессий, возвращаем пустой массив');
      return { sessions: [], total: 0 };
    }
    
    console.log(`📊 Всего ID сессий в SET: ${sessionIds.length}`);
    
    // ИСПРАВЛЕНИЕ: Загружаем ВСЕ сессии порциями, чтобы не превысить лимит размера запроса (10MB)
    // Формируем ключи для получения данных ВСЕХ сессий
    const keys = sessionIds.map(id => `chat:${id}`);
    console.log('Ключи для mget (все сессии):', keys.length);
    
    // Загружаем сессии порциями с адаптивным размером батча (защита от превышения лимита 10MB)
    let BATCH_SIZE = 100; // Безопасное начальное значение
    const sessions = [];
    
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      console.log(`📦 Загружаем батч ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} сессий (${i + 1}-${Math.min(i + BATCH_SIZE, keys.length)}), размер батча: ${BATCH_SIZE}`);
      
      try {
        const batchResults = await redisClient.mget(...batch);
        if (batchResults && Array.isArray(batchResults)) {
          sessions.push(...batchResults);
        }
      } catch (error) {
        console.error(`❌ Ошибка загрузки батча ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        
        // Если ошибка связана с размером запроса, уменьшаем размер батча и повторяем
        if (error.message && error.message.includes('max request size exceeded')) {
          const newBatchSize = Math.floor(BATCH_SIZE / 2);
          if (newBatchSize >= 10) {
            console.log(`🔄 Уменьшаем размер батча с ${BATCH_SIZE} до ${newBatchSize} и повторяем...`);
            BATCH_SIZE = newBatchSize;
            i -= BATCH_SIZE; // Возвращаемся назад, чтобы повторить этот батч
            continue;
          }
        }
        
        // Если не удалось загрузить даже с минимальным батчом, добавляем null
        sessions.push(...new Array(batch.length).fill(null));
      }
    }
    
    console.log('Результат mget (кол-во элементов):', sessions ? sessions.length : 0);
    
    // Фильтруем null (несуществующие ключи) и нормализуем данные
    const validSessions = [];
    const missingSessionIds = [];
    
    sessions.forEach((session, index) => {
      if (session === null) {
        // Запоминаем несуществующие сессии для очистки SET
        missingSessionIds.push(sessionIds[index]);
      } else {
        validSessions.push(session);
      }
    });
    
    console.log(`Прочитано валидных сессий: ${validSessions.length}, несуществующих: ${missingSessionIds.length}`);
    
    // Очищаем SET от несуществующих ключей (в фоне, не блокируя ответ)
    if (missingSessionIds.length > 0) {
      redisClient.srem(sessionsListKey, ...missingSessionIds).catch(err => {
        console.warn('Не удалось очистить SET от несуществующих сессий:', err.message);
      });
      console.log(`🧹 Запланирована очистка SET от ${missingSessionIds.length} несуществующих сессий`);
    }
    
    // Нормализуем данные сессий (защита от старых/некорректных данных)
    if (validSessions.length > 0) {
      validSessions.forEach(session => {
        // Нормализуем messages: если не массив - делаем пустым массивом
        if (!Array.isArray(session.messages)) {
          console.warn('⚠️ Нормализация messages: не массив, исправляем для', session.sessionId, 'тип:', typeof session.messages);
          // Сохраняем оригинальное значение для диагностики
          if (session.messages && typeof session.messages === 'object') {
            console.warn('  Оригинальное значение messages:', JSON.stringify(session.messages).substring(0, 200));
          }
          session.messages = [];
        }
        // Нормализуем contacts: если не объект - делаем null
        if (session.contacts && typeof session.contacts !== 'object') {
          console.warn('⚠️ Нормализация contacts: не объект, исправляем для', session.sessionId);
          session.contacts = null;
        }
      });
      
      // Логируем статистику после нормализации
      const sessionsWithMessages = validSessions.filter(s => s.messages && Array.isArray(s.messages) && s.messages.length > 0);
      const sessionsWithContacts = validSessions.filter(s => s.contacts && (
        (s.contacts.name && s.contacts.name.trim() !== '') || 
        (s.contacts.phone && s.contacts.phone.trim() !== '')
      ));
      console.log(`📊 После нормализации: ${validSessions.length} сессий, ${sessionsWithMessages.length} с сообщениями, ${sessionsWithContacts.length} с контактами`);
    }
    
    // ФИЛЬТРАЦИЯ: Показываем только сессии с данными (сообщения ИЛИ заполненная форма)
    // Это исключает пустые сессии, которые были только инициализированы
    const sessionsWithData = validSessions.filter(session => {
      const hasMessages = session.messages && Array.isArray(session.messages) && session.messages.length > 0;
      // Проверяем контакты: форма считается заполненной, если есть name ИЛИ phone (не пустые строки)
      const hasContacts = session.contacts && (
        (session.contacts.name && session.contacts.name.trim() !== '') || 
        (session.contacts.phone && session.contacts.phone.trim() !== '')
      );
      const hasData = hasMessages || hasContacts;
      
      return hasData;
    });
    
    console.log(`📋 После фильтрации: ${sessionsWithData.length} сессий с данными из ${validSessions.length} всего`);
    
    // Диагностическое логирование для понимания, какие сессии отфильтрованы
    const filteredOut = validSessions.length - sessionsWithData.length;
    if (filteredOut > 0) {
      console.log(`⚠️ Отфильтровано ${filteredOut} пустых сессий (без сообщений и контактов)`);
      
      // Показываем примеры отфильтрованных сессий для диагностики
      const emptySessions = validSessions.filter(s => {
        const hasMessages = s.messages && Array.isArray(s.messages) && s.messages.length > 0;
        const hasContacts = s.contacts && (
          (s.contacts.name && s.contacts.name.trim() !== '') || 
          (s.contacts.phone && s.contacts.phone.trim() !== '')
        );
        return !hasMessages && !hasContacts;
      });
      
      if (emptySessions.length > 0) {
        console.log(`🔍 Примеры пустых сессий (первые 3):`);
        emptySessions.slice(0, 3).forEach((session, idx) => {
          console.log(`  Пустая сессия ${idx + 1}:`, {
            sessionId: session.sessionId?.substring(0, 15),
            source: session.source || 'не указан',
            createdAt: session.createdAt,
            lastUpdated: session.lastUpdated,
            hasMessages: !!(session.messages && Array.isArray(session.messages) && session.messages.length > 0),
            hasContacts: !!(session.contacts && (
        (session.contacts.name && session.contacts.name.trim() !== '') || 
        (session.contacts.phone && session.contacts.phone.trim() !== '')
      )),
            messagesType: typeof session.messages,
            messagesLength: session.messages ? (Array.isArray(session.messages) ? session.messages.length : 'не массив') : 'нет'
          });
        });
      }
    }
    
    // Диагностическое логирование для сессий с данными (первые 5)
    if (sessionsWithData.length > 0) {
      console.log(`🔍 Примеры сессий с данными (первые ${Math.min(5, sessionsWithData.length)}):`);
      sessionsWithData.slice(0, 5).forEach((session, idx) => {
        const hasMessages = session.messages && Array.isArray(session.messages) && session.messages.length > 0;
        const hasContacts = session.contacts && (
          (session.contacts.name && session.contacts.name.trim() !== '') || 
          (session.contacts.phone && session.contacts.phone.trim() !== '')
        );
        const contactsInfo = session.contacts ? {
          name: session.contacts.name || 'нет',
          phone: session.contacts.phone || 'нет',
          category: session.contacts.category || 'нет',
          gift: session.contacts.gift || 'нет',
          messenger: session.contacts.messenger || 'нет',
          wishes: session.contacts.wishes || 'нет'
        } : null;
        console.log(`  Сессия с данными ${idx + 1}:`, {
          sessionId: session.sessionId?.substring(0, 15),
          source: session.source || 'не указан',
          hasMessages,
          messagesLength: session.messages ? session.messages.length : 0,
          hasContacts,
          contacts: contactsInfo,
          createdAt: session.createdAt,
          lastUpdated: session.lastUpdated
        });
      });
    }
    
    // Дополнительная диагностика: проверяем сессии с контактами, но без name/phone
    const sessionsWithOtherContacts = validSessions.filter(s => {
      const hasNameOrPhone = s.contacts && (
        (s.contacts.name && s.contacts.name.trim() !== '') || 
        (s.contacts.phone && s.contacts.phone.trim() !== '')
      );
      const hasOtherFields = s.contacts && (s.contacts.category || s.contacts.gift || s.contacts.messenger || s.contacts.wishes);
      return !hasNameOrPhone && hasOtherFields;
    });
    if (sessionsWithOtherContacts.length > 0) {
      console.log(`⚠️ ВНИМАНИЕ: Найдено ${sessionsWithOtherContacts.length} сессий с контактами, но БЕЗ name/phone (только другие поля формы)`);
      sessionsWithOtherContacts.slice(0, 3).forEach((session, idx) => {
        console.log(`  Сессия с частичными контактами ${idx + 1}:`, {
          sessionId: session.sessionId?.substring(0, 15),
          source: session.source || 'не указан',
          contacts: session.contacts ? Object.keys(session.contacts).filter(k => session.contacts[k]) : null
        });
      });
    }
    
    // ИСПРАВЛЕНИЕ: Простая сортировка по createdAt (время открытия виджета, новые сверху)
    sessionsWithData.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      
      // Сначала по дате создания (убывание - новые сверху)
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      
      // Если даты одинаковые - сортируем по sessionId для стабильности
      return (a.sessionId || '').localeCompare(b.sessionId || '');
    });
    
    console.log(`✅ После сортировки: ${sessionsWithData.length} сессий с данными`);
    
    // Логируем первые 3 сессии для проверки сортировки
    if (sessionsWithData.length > 0) {
      console.log(`🔍 Проверка сортировки (первые 3 сессии по createdAt):`);
      sessionsWithData.slice(0, 3).forEach((session, idx) => {
        console.log(`  ${idx + 1}. ${session.sessionId?.substring(0, 15)}: createdAt=${session.createdAt}`);
      });
    }
    
    // ИСПРАВЛЕНИЕ: Применяем пагинацию ПОСЛЕ фильтрации и сортировки
    const total = sessionsWithData.length;
    const paginatedSessions = sessionsWithData.slice(offset, offset + limit);
    console.log(`📄 Пагинация: показываем ${paginatedSessions.length} из ${total} (offset: ${offset}, limit: ${limit})`);
    
    return { sessions: paginatedSessions, total };
  } catch (error) {
    console.error('❌ Ошибка чтения чатов из Redis:', error);
    console.error('Stack:', error.stack);
    return { sessions: [], total: 0 };
  }
}

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log('Запрос к admin-chats:', req.method, req.url);
    
    // Получаем параметры запроса
    const url = new URL(req.url, `http://${req.headers.host}`);
    const source = url.searchParams.get('source') || 'test'; // По умолчанию 'test'
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    
    console.log('Параметры запроса:', { source, limit, offset });
    
    // Читаем реальные данные из Redis (сортировка и пагинация уже применены в readChats)
    const { sessions: chats, total } = await readChats(source, limit, offset);
    console.log('📊 Итоговый результат: найдено чатов:', chats.length, 'из', total, 'всего сессий');
    
    // Форматируем данные для фронтенда
    const formattedSessions = chats.map(session => ({
      id: session.sessionId,
      createdAt: session.createdAt,
      lastUpdated: session.lastUpdated,
      prompt: session.prompt,
      locale: session.locale,
      contacts: session.contacts || null,
      messageCount: session.messages ? session.messages.length : 0,
      lastMessage: session.messages && session.messages.length > 0 
        ? session.messages[session.messages.length - 1] 
        : null,
      hasContacts: !!(session.contacts && (
        (session.contacts.name && session.contacts.name.trim() !== '') || 
        (session.contacts.phone && session.contacts.phone.trim() !== '')
      ))
    }));
    
    // Логируем финальную статистику
    console.log('✅ Финальная статистика:', {
      total: formattedSessions.length,
      withMessages: formattedSessions.filter(s => s.messageCount > 0).length,
      withContacts: formattedSessions.filter(s => s.hasContacts).length,
      totalInRedis: total
    });
    
    return res.status(200).json({
      success: true,
      sessions: formattedSessions,
      total: total,
      limit: limit,
      offset: offset,
      hasMore: offset + limit < total
    });
    
  } catch (error) {
    console.error('Ошибка получения диалогов:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения диалогов',
      error: error.message 
    });
  }
};