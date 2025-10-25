// Используем тот же Redis клиент что и для каталога
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log('Запрос к admin-session:', req.method, req.url);
    
    // Получаем sessionId из query параметров
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    console.log('URL:', req.url);
    console.log('SessionId из query:', sessionId);
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID не указан в query параметрах' 
      });
    }
    
    // Читаем сессию из Redis
    const chatKey = `chat:${sessionId}`;
    console.log('Ищем в Redis ключ:', chatKey);
    
    const session = await redis.get(chatKey);
    console.log('Найдена сессия в Redis:', !!session);
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        message: 'Сессия не найдена в Redis' 
      });
    }
    
    return res.status(200).json({
      success: true,
      session: {
        id: session.sessionId,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated,
        prompt: session.prompt,
        locale: session.locale,
        contacts: session.contacts || null,
        messages: session.messages || []
      }
    });
    
  } catch (error) {
    console.error('Ошибка получения сессии:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения сессии',
      error: error.message 
    });
  }
};