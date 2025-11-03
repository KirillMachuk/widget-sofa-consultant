// API для очистки всех сессий из Redis (только для администратора)
const redisClient = require('../utils/redis-client');

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🗑️ Начинаем очистку сессий из Redis...');
    
    // Получаем список всех session IDs из SET
    const sessionIds = await redisClient.smembers('sessions:list');
    console.log(`Найдено session IDs в SET: ${sessionIds ? sessionIds.length : 0}`);
    
    let deletedCount = 0;
    
    if (sessionIds && sessionIds.length > 0) {
      // Удаляем каждую сессию
      for (const sessionId of sessionIds) {
        const chatKey = `chat:${sessionId}`;
        try {
          await redisClient.del(chatKey);
          deletedCount++;
        } catch (error) {
          console.error(`Ошибка удаления ключа ${chatKey}:`, error.message);
        }
      }
      
      // Очищаем SET со списком сессий
      try {
        await redisClient.del('sessions:list');
        console.log('✅ SET sessions:list очищен');
      } catch (error) {
        console.error('Ошибка очистки sessions:list:', error.message);
      }
    }
    
    console.log(`✅ Очистка завершена. Удалено сессий: ${deletedCount}`);
    
    return res.status(200).json({
      success: true,
      message: 'Все сессии удалены из Redis',
      deletedCount
    });
    
  } catch (error) {
    console.error('❌ Ошибка очистки сессий:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка очистки сессий',
      error: error.message
    });
  }
};

