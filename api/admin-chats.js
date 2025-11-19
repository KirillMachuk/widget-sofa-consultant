// Используем новый Redis клиент с retry логикой
const redisClient = require('../utils/redis-client');

// Читаем все чаты из Redis используя список сессий из SET
async function readChats(source = 'test', limit = 100, offset = 0) {
  try {
    console.log('🔍 Получаем список сессий из Redis SET для источника:', source);
    
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
    
    // ИСПРАВЛЕНИЕ: Загружаем ВСЕ сессии, а не только пагинированные
    // Формируем ключи для получения данных ВСЕХ сессий
    const keys = sessionIds.map(id => `chat:${id}`);
    console.log('Ключи для mget (все сессии):', keys.length);
    
    // Читаем ВСЕ сессии из Redis
    const sessions = await redisClient.mget(...keys);
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
          console.warn('⚠️ Нормализация messages: не массив, исправляем для', session.sessionId);
          session.messages = [];
        }
        // Нормализуем contacts: если не объект - делаем null
        if (session.contacts && typeof session.contacts !== 'object') {
          console.warn('⚠️ Нормализация contacts: не объект, исправляем для', session.sessionId);
          session.contacts = null;
        }
      });
    }
    
    // ИСПРАВЛЕНИЕ: Фильтруем сессии с действиями (сообщения или контакты) ДО пагинации
    const sessionsWithData = validSessions.filter(session => {
      const hasMessages = session.messages && Array.isArray(session.messages) && session.messages.length > 0;
      const hasContacts = session.contacts && (session.contacts.name || session.contacts.phone);
      return hasMessages || hasContacts;
    });
    
    console.log(`📋 После фильтрации по действиям: ${sessionsWithData.length} из ${validSessions.length}`);
    
    // ИСПРАВЛЕНИЕ: Стабильная сортировка (по lastUpdated, затем по sessionId для одинаковых дат)
    sessionsWithData.sort((a, b) => {
      const dateA = new Date(a.lastUpdated || a.createdAt || 0);
      const dateB = new Date(b.lastUpdated || b.createdAt || 0);
      
      // Сначала по дате (убывание - новые сверху)
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB - dateA;
      }
      
      // Если даты одинаковые - сортируем по sessionId для стабильности
      return (a.sessionId || '').localeCompare(b.sessionId || '');
    });
    
    console.log(`✅ После сортировки: ${sessionsWithData.length} сессий`);
    
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
    
    // Читаем реальные данные из Redis (фильтрация и сортировка уже применены в readChats)
    const { sessions: chats, total } = await readChats(source, limit, offset);
    console.log('📊 Итоговый результат: найдено чатов:', chats.length, 'из', total, 'с действиями');
    
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