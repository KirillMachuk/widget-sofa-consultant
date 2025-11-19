// API для получения метрик ошибок в админ-панели
const redisClient = require('../utils/redis-client');

// Функция для определения источника из запроса
function detectSource(req) {
  // Пробуем получить из referer или query параметра
  const referer = req.headers.referer || req.headers.origin || '';
  if (referer && referer.includes('nm-shop.by')) {
    return 'nm-shop';
  }
  // Проверяем query параметр
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sourceParam = url.searchParams.get('source');
  if (sourceParam === 'nm-shop') {
    return 'nm-shop';
  }
  // По умолчанию 'test' для Vercel виджета
  return 'test';
}

// Получить метрики ошибок за период (часы, дни)
async function getErrorTimeSeries(source, period = '24h') {
  const now = Date.now();
  let startTime;
  
  if (period === '24h') {
    startTime = now - (24 * 60 * 60 * 1000); // 24 часа назад
  } else if (period === '7d') {
    startTime = now - (7 * 24 * 60 * 60 * 1000); // 7 дней назад
  } else if (period === '30d') {
    startTime = now - (30 * 24 * 60 * 60 * 1000); // 30 дней назад
  } else {
    startTime = now - (24 * 60 * 60 * 1000); // По умолчанию 24 часа
  }
  
  // Получаем все ключи ошибок для источника
  const errorKeys = await redisClient.getAllKeys(`error:${source}:*`);
  
  const errors = [];
  if (errorKeys && errorKeys.length > 0) {
    // Получаем детали ошибок
    const errorDetails = await redisClient.mget(...errorKeys);
    
    for (let i = 0; i < errorKeys.length; i++) {
      const error = errorDetails[i];
      if (error && error.timestamp) {
        const errorTime = new Date(error.timestamp).getTime();
        if (errorTime >= startTime) {
          errors.push({
            ...error,
            key: errorKeys[i]
          });
        }
      }
    }
  }
  
  // Группируем по времени
  const timeSeries = {};
  errors.forEach(error => {
    const date = new Date(error.timestamp);
    let timeKey;
    
    if (period === '24h') {
      // Группируем по часам
      timeKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:00:00`;
    } else {
      // Группируем по дням
      timeKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    if (!timeSeries[timeKey]) {
      timeSeries[timeKey] = {
        timestamp: timeKey,
        widget_load_error: 0,
        session_init_error: 0,
        api_error: 0,
        slow_request: 0,
        redis_error: 0,
        total: 0
      };
    }
    
    timeSeries[timeKey][error.type] = (timeSeries[timeKey][error.type] || 0) + 1;
    timeSeries[timeKey].total += 1;
  });
  
  // Преобразуем в массив и сортируем по времени
  return Object.values(timeSeries).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

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
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sourceParam = url.searchParams.get('source');
    const period = url.searchParams.get('period') || '24h';
    
    const source = sourceParam || detectSource(req);
    
    // Получаем счетчики ошибок по типам
    const errorTypes = ['widget_load_error', 'session_init_error', 'api_error', 'slow_request', 'redis_error'];
    const errorCounts = {};
    
    for (const errorType of errorTypes) {
      const count = await redisClient.get(`analytics:error:${errorType}:${source}`).catch(() => 0);
      errorCounts[errorType] = parseInt(count || 0, 10);
    }
    
    // Вычисляем общее количество ошибок
    const totalErrors = Object.values(errorCounts).reduce((sum, count) => sum + count, 0);
    
    // Получаем общее количество запросов (page_view)
    const totalRequests = parseInt(await redisClient.get(`analytics:page_view:${source}`).catch(() => 0) || 0, 10);
    
    // Процент проблемных запросов
    const errorRate = totalRequests > 0 ? parseFloat(((totalErrors / totalRequests) * 100).toFixed(2)) : 0;
    
    // Определяем общий статус
    let status = 'healthy';
    if (errorRate > 10) {
      status = 'error';
    } else if (errorRate > 5) {
      status = 'degraded';
    }
    
    // Получаем последние 50 ошибок
    const errorsListKey = `errors:list:${source}`;
    const errorKeys = await redisClient.lrange(errorsListKey, 0, 49).catch(() => []); // Последние 50
    
    const recentErrors = [];
    if (errorKeys && errorKeys.length > 0) {
      const errorDetails = await redisClient.mget(...errorKeys);
      
      for (let i = 0; i < errorKeys.length; i++) {
        const error = errorDetails[i];
        if (error) {
          recentErrors.push({
            type: error.type,
            message: error.message || 'Unknown error',
            timestamp: error.timestamp,
            session_id: error.session_id || null,
            url: error.url || null,
            status: error.status || null,
            latency: error.latency || null
          });
        }
      }
    }
    
    // Сортируем по времени (новые сверху)
    recentErrors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Получаем график ошибок за период
    const timeSeries = await getErrorTimeSeries(source, period);
    
    return res.status(200).json({
      success: true,
      source: source,
      errors: {
        counts: errorCounts,
        total: totalErrors,
        errorRate: errorRate,
        status: status,
        recent: recentErrors.slice(0, 50), // Максимум 50 последних
        timeSeries: timeSeries,
        period: period
      }
    });
    
  } catch (error) {
    console.error('Ошибка получения метрик ошибок:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения метрик ошибок',
      error: error.message 
    });
  }
};

