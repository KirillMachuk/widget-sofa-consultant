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
    
    // Получаем sessionId из URL
    const sessionId = req.url.split('/').pop();
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID не указан' 
      });
    }
    
    // Пока возвращаем пустую сессию
    return res.status(200).json({
      success: true,
      session: {
        id: sessionId,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        prompt: 'Тестовая сессия',
        locale: 'ru',
        contacts: null,
        messages: []
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