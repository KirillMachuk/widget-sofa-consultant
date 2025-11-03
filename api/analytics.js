// API для трекинга аналитических событий
const redisClient = require('../utils/redis-client');

// Список допустимых типов событий
const ALLOWED_EVENTS = ['page_view', 'widget_open', 'form_submit'];

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
    const { event_type, session_id } = req.body || {};
    
    // Валидация типа события
    if (!event_type || !ALLOWED_EVENTS.includes(event_type)) {
      return res.status(400).json({ 
        error: 'Invalid event_type', 
        allowed: ALLOWED_EVENTS 
      });
    }
    
    // Инкрементируем счетчик в Redis
    const analyticsKey = `analytics:${event_type}`;
    
    try {
      // Используем INCR для атомарного инкремента
      // Если ключ не существует, INCR инициализирует его со значением 1
      const currentValue = await redisClient.incr(analyticsKey);
      
      console.log(`Аналитика: ${event_type} инкрементирован`, {
        session_id,
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

