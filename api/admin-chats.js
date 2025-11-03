// Используем новый Redis клиент с retry логикой
const redisClient = require('../utils/redis-client');

// Читаем все чаты из Redis используя список сессий из SET
async function readChats() {
  try {
    console.log('🔍 Получаем список сессий из Redis SET...');
    
    // Получаем список ID сессий из Redis SET
    let sessionIds = await redisClient.smembers('sessions:list');
    console.log(`Найдено ID сессий в SET: ${sessionIds ? sessionIds.length : 0}`);
    
    // Если SET пустой, пытаемся использовать KEYS как fallback (миграция)
    if (!sessionIds || sessionIds.length === 0) {
      console.log('SET пустой, пытаемся получить ключи через KEYS...');
      try {
        const keys = await redisClient.keys('chat:*');
        if (keys && keys.length > 0) {
          console.log(`Найдено ключей через KEYS: ${keys.length}`);
          // Извлекаем session IDs из ключей
          sessionIds = keys.map(key => key.replace('chat:', ''));
          // Попытка заполнить SET (не блокируем если не получится)
          if (sessionIds.length > 0) {
            redisClient.sadd('sessions:list', ...sessionIds).catch(err => {
              console.warn('Не удалось заполнить SET:', err.message);
            });
          }
        }
      } catch (keysError) {
        console.error('KEYS тоже не работает:', keysError.message);
        return [];
      }
    }
    
    if (!sessionIds || sessionIds.length === 0) {
      console.log('Нет сессий, возвращаем пустой массив');
      return [];
    }
    
    // Формируем ключи для получения данных сессий
    const keys = sessionIds.map(id => `chat:${id}`);
    console.log('Ключи для mget:', keys);
    
    // Читаем все сессии одним запросом
    const sessions = await redisClient.mget(...keys);
    console.log('Результат mget (кол-во элементов):', sessions ? sessions.length : 0);
    const validSessions = sessions.filter(session => session !== null);
    console.log(`Прочитано валидных сессий: ${validSessions.length}`);
    
    // Логируем первую сессию для отладки
    if (validSessions.length > 0) {
      console.log('Пример первой сессии:', JSON.stringify(validSessions[0], null, 2));
    }
    
    return validSessions;
  } catch (error) {
    console.error('❌ Ошибка чтения чатов из Redis:', error);
    console.error('Stack:', error.stack);
    return [];
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
    
    // Читаем реальные данные из Redis
    const chats = await readChats();
    console.log('Найдено чатов в Redis:', chats.length);
    
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
      hasContacts: !!(session.contacts && (session.contacts.name || session.contacts.phone))
    }));
    
    // Логируем статистику перед фильтрацией
    console.log('До фильтрации:', {
      total: formattedSessions.length,
      withMessages: formattedSessions.filter(s => s.messageCount > 0).length,
      withContacts: formattedSessions.filter(s => s.hasContacts).length,
      empty: formattedSessions.filter(s => s.messageCount === 0 && !s.hasContacts).length
    });
    
    // ВРЕМЕННО: Отключаем фильтр для диагностики
    // Фильтруем пустые сессии (без сообщений и без контактов)
    // const sessionsWithData = formattedSessions.filter(session => 
    //   session.messageCount > 0 || session.hasContacts
    // );
    const sessionsWithData = formattedSessions; // Показываем ВСЕ сессии
    
    // Сортировка по дате последнего обновления (самые новые сверху)
    sessionsWithData.sort((a, b) => {
      const dateA = new Date(a.lastUpdated || a.createdAt || 0);
      const dateB = new Date(b.lastUpdated || b.createdAt || 0);
      return dateB - dateA; // Сортировка по убыванию (новые сверху)
    });
    
    return res.status(200).json({
      success: true,
      sessions: sessionsWithData,
      total: sessionsWithData.length
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