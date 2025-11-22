// Используем новый Redis клиент с retry логикой
const redisClient = require('../utils/redis-client');

// Функция для вычисления реальной даты последней активности на основе сообщений и контактов
function calculateDisplayDate(session) {
  let maxTimestamp = null;
  
  // Проверяем timestamp последнего сообщения
  if (session.messages && Array.isArray(session.messages) && session.messages.length > 0) {
    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage && lastMessage.timestamp) {
      const msgTime = new Date(lastMessage.timestamp).getTime();
      if (msgTime > 0 && !isNaN(msgTime)) {
        maxTimestamp = Math.max(maxTimestamp || 0, msgTime);
      }
    }
  }
  
  // Проверяем timestamp контактной формы
  if (session.contacts && session.contacts.timestamp) {
    const contactTime = new Date(session.contacts.timestamp).getTime();
    if (contactTime > 0 && !isNaN(contactTime)) {
      maxTimestamp = Math.max(maxTimestamp || 0, contactTime);
    }
  }
  
  // Fallback на lastUpdated или createdAt
  if (maxTimestamp) {
    return new Date(maxTimestamp).toISOString();
  }
  
  if (session.lastUpdated) {
    return session.lastUpdated;
  }
  
  return session.createdAt || new Date().toISOString();
}

// ОПТИМИЗИРОВАННАЯ ФУНКЦИЯ: Читаем чаты используя ZSET индекс
async function readChats(source = 'test', limit = 100, offset = 0) {
  try {
    console.log(`🔍 Загружаем сессии из индекса для источника: ${source}, limit: ${limit}, offset: ${offset}`);
    
    // Используем ZSET индекс для быстрого получения отсортированных ID
    const indexKey = source === 'nm-shop' ? 'sessions:index:nm-shop' : 'sessions:index:test';
    
    // Получаем общее количество сессий в индексе
    const total = await redisClient.zcard(indexKey);
    console.log(`📊 Всего сессий в индексе '${source}': ${total}`);
    
    if (total === 0) {
      console.log('Нет сессий в индексе');
      return { sessions: [], total: 0 };
    }
    
    // Получаем ID сессий для текущей страницы (отсортированы по времени, новые первыми)
    // ZREVRANGE возвращает элементы от большего score к меньшему (reverse)
    const sessionIds = await redisClient.zrevrange(indexKey, offset, offset + limit - 1);
    console.log(`📄 Получено ${sessionIds.length} ID сессий из индекса (offset: ${offset}, limit: ${limit})`);
    
    if (sessionIds.length === 0) {
      return { sessions: [], total };
    }
    
    // Загружаем полные данные сессий батчами
    const keys = sessionIds.map(id => `chat:${id}`);
    const sessions = [];
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
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
    
    console.log('Результат mget (кол-во элементов):', sessions ? sessions.length : 0);
    
    // Фильтруем null (несуществующие ключи) и валидируем данные
    const validSessions = [];
    const missingSessionIds = [];
    
    sessions.forEach((session, index) => {
      if (session === null) {
        if (sessionIds[index]) {
          missingSessionIds.push(sessionIds[index]);
        }
      } else {
        validSessions.push(session);
      }
    });
    
    console.log(`Прочитано валидных сессий: ${validSessions.length}, несуществующих: ${missingSessionIds.length}`);
    
    // Очищаем индекс от несуществующих ключей (в фоне, не блокируя ответ)
    if (missingSessionIds.length > 0) {
      redisClient.zrem(indexKey, ...missingSessionIds).catch(err => {
        console.warn('Не удалось очистить индекс от несуществующих сессий:', err.message);
      });
      console.log(`🧹 Запланирована очистка индекса от ${missingSessionIds.length} несуществующих сессий`);
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
    
    // Фильтрация: показываем только сессии с данными
    const sessionsWithData = validSessions.filter(session => {
      const hasMessages = session.messages && Array.isArray(session.messages) && session.messages.length > 0;
      const hasContacts = session.contacts && (
        (session.contacts.name && session.contacts.name.trim() !== '') || 
        (session.contacts.phone && session.contacts.phone.trim() !== '')
      );
      
      return hasMessages || hasContacts;
    });
    
    console.log(`✅ Финальный результат для '${source}': ${sessionsWithData.length} сессий с данными из ${total} всего в индексе (offset: ${offset}, limit: ${limit})`);
    
    return { sessions: sessionsWithData, total };
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
    
    // Читаем данные из Redis используя оптимизированный индекс
    const { sessions: chats, total } = await readChats(source, limit, offset);
    console.log('📊 Итоговый результат: найдено чатов:', chats.length, 'из', total, 'всего сессий');
    
    // Форматируем данные для фронтенда
    const formattedSessions = chats.map(session => {
      // Вычисляем реальную дату последней активности на основе сообщений и контактов
      const displayDate = calculateDisplayDate(session);
      return {
        id: session.sessionId,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated,
        displayDate: displayDate, // Дата для отображения - последнее сообщение/контакт или создание
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
      };
    });
    
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
