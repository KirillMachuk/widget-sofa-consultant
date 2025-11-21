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
    
    // ОПТИМИЗАЦИЯ: Загружаем индекс для сортировки и подсчета total, затем полные данные только для нужной страницы
    const keys = sessionIds.map(id => `chat:${id}`);
    console.log('Ключи для загрузки:', keys.length);
    
    // ШАГ 1: Загружаем индекс (ID + createdAt) для сортировки и фильтрации
    const indexBatchSize = 50;
    const sessionIndex = [];
    let total = 0; // Подсчитываем total параллельно с индексом
    
    // Загружаем индекс и считаем total одновременно
    for (let i = 0; i < keys.length; i += indexBatchSize) {
      const batch = keys.slice(i, i + indexBatchSize);
      try {
        const batchResults = await redisClient.mget(...batch);
        if (batchResults && Array.isArray(batchResults)) {
          batchResults.forEach((session, idx) => {
            if (session && session.sessionId) {
              sessionIndex.push({
                sessionId: session.sessionId,
                createdAt: session.createdAt || session.lastUpdated || new Date(0).toISOString(),
                index: i + idx
              });
              
              // Подсчитываем total параллельно (проверяем наличие данных)
              const hasMessages = session.messages && Array.isArray(session.messages) && session.messages.length > 0;
              const hasContacts = session.contacts && (
                (session.contacts.name && session.contacts.name.trim() !== '') || 
                (session.contacts.phone && session.contacts.phone.trim() !== '')
              );
              if (hasMessages || hasContacts) {
                total++;
              }
            }
          });
        }
      } catch (error) {
        console.error(`❌ Ошибка загрузки индекса батча ${Math.floor(i / indexBatchSize) + 1}:`, error.message);
      }
    }
    
    // Сортируем индекс по дате создания (новые сверху)
    sessionIndex.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Применяем пагинацию на уровне индекса
    const paginatedIndex = sessionIndex.slice(offset, offset + limit);
    console.log(`📄 Пагинация на уровне индекса: загружаем ${paginatedIndex.length} из ${sessionIndex.length} (offset: ${offset}, limit: ${limit})`);
    console.log(`📊 Всего сессий с данными: ${total}`);
    
    // ШАГ 2: Загружаем полные данные только для нужной страницы
    const paginatedKeys = paginatedIndex.map(item => `chat:${item.sessionId}`);
    const sessions = [];
    
    if (paginatedKeys.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < paginatedKeys.length; i += BATCH_SIZE) {
        const batch = paginatedKeys.slice(i, i + BATCH_SIZE);
        try {
          const batchResults = await redisClient.mget(...batch);
          if (batchResults && Array.isArray(batchResults)) {
            sessions.push(...batchResults);
          }
        } catch (error) {
          console.error(`❌ Ошибка загрузки батча ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
          sessions.push(...new Array(batch.length).fill(null));
        }
      }
    }
    
    console.log('Результат mget (кол-во элементов):', sessions ? sessions.length : 0);
    
    // Фильтруем null (несуществующие ключи) и нормализуем данные
    const validSessions = [];
    const missingSessionIds = [];
    
    sessions.forEach((session, index) => {
      if (session === null) {
        if (paginatedIndex[index]) {
          missingSessionIds.push(paginatedIndex[index].sessionId);
        }
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
        if (!Array.isArray(session.messages)) {
          session.messages = [];
        }
        if (session.contacts && typeof session.contacts !== 'object') {
          session.contacts = null;
        }
      });
      
      const sessionsWithMessages = validSessions.filter(s => s.messages && Array.isArray(s.messages) && s.messages.length > 0);
      const sessionsWithContacts = validSessions.filter(s => s.contacts && (
        (s.contacts.name && s.contacts.name.trim() !== '') || 
        (s.contacts.phone && s.contacts.phone.trim() !== '')
      ));
      console.log(`📊 После нормализации: ${validSessions.length} сессий, ${sessionsWithMessages.length} с сообщениями, ${sessionsWithContacts.length} с контактами`);
    }
    
    // ФИЛЬТРАЦИЯ: Показываем только сессии с данными (сообщения ИЛИ заполненная форма)
    const sessionsWithData = validSessions.filter(session => {
      const hasMessages = session.messages && Array.isArray(session.messages) && session.messages.length > 0;
      const hasContacts = session.contacts && (
        (session.contacts.name && session.contacts.name.trim() !== '') || 
        (session.contacts.phone && session.contacts.phone.trim() !== '')
      );
      return hasMessages || hasContacts;
    });
    
    console.log(`✅ Финальный результат: ${sessionsWithData.length} сессий с данными из ${total} всего (offset: ${offset}, limit: ${limit})`);
    
    const paginatedSessions = sessionsWithData;
    
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