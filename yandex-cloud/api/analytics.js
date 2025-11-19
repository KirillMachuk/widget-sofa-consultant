// API для трекинга аналитических событий
const redisClient = require('../utils/redis-client');

// Список допустимых типов событий
const ALLOWED_EVENTS = ['page_view', 'widget_open', 'form_submit'];

// Express handler для локальной разработки
async function handler(req, res) {
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
}

// Export для Express (локальная разработка)
module.exports = handler;

// Export для Yandex Cloud Functions (production)
module.exports.cloudHandler = async (event, context) => {
  // Адаптация Yandex Cloud Functions event в Express req/res формат
  const req = {
    method: event.httpMethod || 'POST',
    body: typeof event.body === 'string' ? JSON.parse(event.body) : event.body,
    headers: event.headers || {},
    url: event.url || '/api/analytics'
  };
  
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader: function(name, value) {
      this.headers[name] = value;
    },
    status: function(code) {
      this.statusCode = code;
      return {
        json: (data) => {
          this.body = JSON.stringify(data);
          return this;
        },
        end: () => {
          this.body = '';
          return this;
        }
      };
    },
    json: function(data) {
      this.body = JSON.stringify(data);
      return this;
    },
    end: function() {
      this.body = '';
      return this;
    }
  };
  
  try {
    await handler(req, res);
    
    return {
      statusCode: res.statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...res.headers
      },
      body: res.body
    };
  } catch (error) {
    console.error('Cloud handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

