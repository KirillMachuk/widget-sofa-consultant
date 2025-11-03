// Используем новый Redis клиент с retry логикой
const redisClient = require('../utils/redis-client');

// Читаем все чаты из Redis с использованием SCAN (неблокирующая операция)
async function readChats() {
  try {
    console.log('🔍 Сканируем Redis для поиска сессий...');
    
    // Добавляем таймаут для всего процесса
    const keys = await Promise.race([
      redisClient.getAllKeys('chat:*', 50),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Keys lookup timeout')), 10000)
      )
    ]);
    
    console.log(`Найдено ключей в Redis: ${keys.length}`);
    
    if (keys.length === 0) {
      console.log('Нет ключей, возвращаем пустой массив');
      return [];
    }
    
    // Читаем все сессии одним запросом
    const sessions = await redisClient.mget(...keys);
    const validSessions = sessions.filter(session => session !== null);
    console.log(`Прочитано сессий: ${validSessions.length}`);
    
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
    
    // Фильтруем пустые сессии (без сообщений и без контактов)
    const sessionsWithData = formattedSessions.filter(session => 
      session.messageCount > 0 || session.hasContacts
    );
    
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