// Единый Redis клиент с connection pooling и retry логикой
const { Redis } = require('@upstash/redis');

// Создаем единственный экземпляр Redis клиента
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Retry логика для Redis операций
async function withRetry(operation, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Redis retry ${i + 1}/${maxRetries}:`, error.message);
      
      if (i === maxRetries - 1) {
        throw error;
      }
      
      // Экспоненциальная задержка
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
}

// Безопасные обертки для Redis операций
const redisClient = {
  // GET с retry
  async get(key) {
    return withRetry(() => redis.get(key));
  },

  // SET с retry
  async set(key, value, options = {}) {
    return withRetry(() => redis.set(key, value, options));
  },

  // SETEX с retry
  async setex(key, seconds, value) {
    return withRetry(() => redis.setex(key, seconds, value));
  },

  // MGET с retry
  async mget(...keys) {
    return withRetry(() => redis.mget(...keys));
  },

  // INCR с retry
  async incr(key) {
    return withRetry(() => redis.incr(key));
  },

  // SCAN для безопасного получения ключей (замена keys())
  async scan(cursor = 0, match = '*', count = 100) {
    return withRetry(() => redis.scan(cursor, { match, count }), 3, 1000);
  },

  // KEYS - старая блокирующая команда (не рекомендуется для production, но нужна если SCAN не работает)
  async keys(pattern = '*') {
    return withRetry(() => redis.keys(pattern), 1, 5000);
  },

  // Получить все ключи с помощью SCAN (неблокирующая операция)
  async getAllKeys(pattern = '*', batchSize = 100) {
    const keys = [];
    let cursor = 0;
    let iterations = 0;
    const maxIterations = 100; // Защита от бесконечного цикла
    
    try {
      do {
        const result = await Promise.race([
          this.scan(cursor, pattern, batchSize),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('SCAN timeout')), 5000)
          )
        ]);
        
        // Проверяем формат результата
        if (Array.isArray(result)) {
          cursor = result[0];
          keys.push(...result[1]);
        } else if (result && typeof result === 'object') {
          // Возможно, Upstash возвращает объект
          cursor = result.cursor || result[0] || 0;
          const resultKeys = result.keys || result[1] || [];
          keys.push(...resultKeys);
        } else {
          console.error('Unexpected SCAN result format:', result);
          break;
        }
        
        iterations++;
        if (iterations >= maxIterations) {
          console.warn('SCAN max iterations reached');
          break;
        }
      } while (cursor !== 0 && cursor !== '0');
    } catch (error) {
      console.error('SCAN error:', error.message);
      // Fallback на KEYS если SCAN не работает
      console.log('Falling back to KEYS command...');
      try {
        const fallbackKeys = await this.keys(pattern);
        console.log(`KEYS returned ${fallbackKeys ? fallbackKeys.length : 0} keys`);
        return fallbackKeys || [];
      } catch (fallbackError) {
        console.error('KEYS fallback also failed:', fallbackError.message);
        throw error;
      }
    }
    
    return keys;
  },

  // Проверка доступности Redis
  async ping() {
    try {
      await withRetry(() => redis.ping(), 1, 500);
      return true;
    } catch (error) {
      console.error('Redis ping failed:', error.message);
      return false;
    }
  },

  // Graceful fallback операции
  async safeGet(key, fallback = null) {
    try {
      return await this.get(key);
    } catch (error) {
      console.error(`Redis GET failed for key ${key}:`, error.message);
      return fallback;
    }
  },

  async safeSet(key, value, options = {}) {
    try {
      return await this.set(key, value, options);
    } catch (error) {
      console.error(`Redis SET failed for key ${key}:`, error.message);
      return false;
    }
  }
};

module.exports = redisClient;
