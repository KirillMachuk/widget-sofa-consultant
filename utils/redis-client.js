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

  // SCAN для безопасного получения ключей (замена keys())
  async scan(cursor = 0, match = '*', count = 100) {
    return withRetry(() => redis.scan(cursor, { match, count }));
  },

  // Получить все ключи с помощью SCAN (неблокирующая операция)
  async getAllKeys(pattern = '*', batchSize = 100) {
    const keys = [];
    let cursor = 0;
    
    do {
      const result = await this.scan(cursor, pattern, batchSize);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== 0);
    
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
