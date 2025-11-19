// Rate limiter для защиты от злоупотреблений
const redisClient = require('./redis-client');

// Настройки rate limiting
const RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000, // 1 минута
  maxRequests: 50, // максимум 50 запросов в минуту
  keyPrefix: 'rate_limit:'
};

// Получить идентификатор клиента из запроса (session_id или IP)
function getClientIdentifier(req) {
  // Сначала пробуем получить session_id из тела запроса
  if (req.body && req.body.session_id) {
    return req.body.session_id;
  }
  
  // Fallback на IP если session_id недоступен
  return req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         'unknown';
}

// Проверить лимит запросов
async function checkRateLimit(req) {
  const clientIdentifier = getClientIdentifier(req);
  const key = `${RATE_LIMIT_CONFIG.keyPrefix}${clientIdentifier}`;
  
  try {
    // Используем INCR для атомарного инкремента
    // Если ключ не существует, INCR создаст его со значением 1
    const newCount = await redisClient.incr(key);
    
    // Устанавливаем TTL при первом создании ключа
    if (newCount === 1) {
      await redisClient.expire(key, Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000));
    }
    
    if (newCount > RATE_LIMIT_CONFIG.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: RATE_LIMIT_CONFIG.windowMs
      };
    }
    
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
  getClientIdentifier
};

