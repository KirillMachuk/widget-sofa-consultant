// Rate limiter для защиты от злоупотреблений
const redisClient = require('./redis-client');

// Настройки rate limiting
const RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000, // 1 минута
  maxRequests: 10, // максимум 10 запросов в минуту
  keyPrefix: 'rate_limit:'
};

// Получить IP адрес из запроса
function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         'unknown';
}

// Проверить лимит запросов
async function checkRateLimit(req) {
  const clientIP = getClientIP(req);
  const key = `${RATE_LIMIT_CONFIG.keyPrefix}${clientIP}`;
  
  try {
    // Получаем текущее количество запросов
    const currentCount = await redisClient.get(key);
    const count = currentCount ? parseInt(currentCount) : 0;
    
    if (count >= RATE_LIMIT_CONFIG.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: RATE_LIMIT_CONFIG.windowMs
      };
    }
    
    // Увеличиваем счетчик
    const newCount = count + 1;
    await redisClient.setex(key, Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000), newCount);
    
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.maxRequests - newCount,
      resetTime: RATE_LIMIT_CONFIG.windowMs
    };
    
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // При ошибке Redis разрешаем запрос (fail open)
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.maxRequests,
      resetTime: RATE_LIMIT_CONFIG.windowMs
    };
  }
}

// Middleware для rate limiting
function rateLimitMiddleware() {
  return async (req, res, next) => {
    const result = await checkRateLimit(req);
    
    if (!result.allowed) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Превышен лимит запросов. Попробуйте позже.',
        retryAfter: Math.ceil(result.resetTime / 1000)
      });
    }
    
    // Добавляем заголовки с информацией о лимитах
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_CONFIG.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Date.now() + result.resetTime);
    
    if (next) next();
  };
}

module.exports = {
  checkRateLimit,
  rateLimitMiddleware,
  getClientIP
};
