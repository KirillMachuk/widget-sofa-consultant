// API для трекинга аналитических событий
const redisClient = require('../utils/redis-client');

// Список допустимых типов событий
const ALLOWED_EVENTS = ['page_view', 'widget_open', 'form_submit'];

// Функция для определения источника из запроса
function detectSource(req) {
  // Пробуем получить из referer
  const referer = req.headers.referer || req.headers.origin || '';
  if (referer && referer.includes('nm-shop.by')) {
    return 'nm-shop';
  }
  // По умолчанию 'test' для Vercel виджета
  return 'test';
}

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Pragma');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { event_type, session_id } = req.body || {};
    
    // Валидация типа события
    if (!event_type || !ALLOWED_EVENTS.includes(event_type)) {
      return res.status(400).json({ 
        error: 'Invalid event_type', 
        allowed: ALLOWED_EVENTS 
      });
    }
    
    // Определяем источник из referer запроса
    const source = detectSource(req);
    
    // Инкрементируем счетчик в Redis с учетом источника
    const analyticsKey = `analytics:${event_type}:${source}`;
    
    try {
      // Используем INCR для атомарного инкремента
      // Если ключ не существует, INCR инициализирует его со значением 1
      const currentValue = await redisClient.incr(analyticsKey);
      
      console.log(`Аналитика: ${event_type} инкрементирован для источника ${source}`, {
        session_id,
        source,
        newValue: currentValue,
        timestamp: new Date().toISOString()
      });
      
      return res.status(200).json({ 
        success: true, 
        event_type,
        message: 'Event tracked successfully' 
      });
    } catch (redisError) {
      console.error('Ошибка записи аналитики в Redis:', redisError);
      // Возвращаем успех даже при ошибке Redis, чтобы не блокировать виджет
      return res.status(200).json({ 
        success: false, 
        event_type,
        message: 'Event tracking failed (non-blocking)' 
      });
    }
    
  } catch (error) {
    console.error('Ошибка обработки аналитики:', error);
    // Возвращаем успех чтобы не блокировать виджет
    return res.status(200).json({ 
      success: false, 
      message: 'Event tracking error (non-blocking)',
      error: error.message 
    });
  }
};

