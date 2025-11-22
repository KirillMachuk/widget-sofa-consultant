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
  // GET с retry (Upstash автоматически сериализует/десериализует JSON)
  async get(key) {
    return Promise.race([
      withRetry(() => redis.get(key)),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis GET timeout after 10s')), 10000)
      )
    ]);
  },

  // SET с retry (Upstash автоматически сериализует/десериализует JSON)
  async set(key, value, options = {}) {
    return Promise.race([
      withRetry(() => redis.set(key, value, options)),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis SET timeout after 10s')), 10000)
      )
    ]);
  },

  // SETEX с retry (Upstash автоматически сериализует/десериализует JSON)
  async setex(key, seconds, value) {
    return withRetry(() => redis.setex(key, seconds, value));
  },

  // MGET с retry и логированием
  async mget(...keys) {
    console.log('🔍 redisClient.mget: Запрос для', keys.length, 'ключей');
    const results = await Promise.race([
      withRetry(() => redis.mget(...keys)),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis MGET timeout after 15s')), 15000)
      )
    ]);
    console.log('✅ redisClient.mget: Получено', results ? results.length : 0, 'результатов');
    // Логируем первый результат для диагностики
    if (results && results.length > 0 && results[0]) {
      const first = results[0];
      if (first && first.messages) {
        console.log('🔍 redisClient.mget [0]: messages type:', typeof first.messages, 'isArray:', Array.isArray(first.messages));
      }
    }
    return results || [];
  },

  // INCR с retry
  async incr(key) {
    return withRetry(() => redis.incr(key));
  },

  // Redis SET операции
  async sadd(key, ...members) {
    return withRetry(() => redis.sadd(key, ...members));
  },

  async smembers(key) {
    return withRetry(() => redis.smembers(key));
  },

  async srem(key, ...members) {
    return withRetry(() => redis.srem(key, ...members));
  },

  // SCARD для подсчета элементов в SET
  async scard(key) {
    return withRetry(() => redis.scard(key));
  },

  // EXPIRE для установки TTL
  async expire(key, seconds) {
    return withRetry(() => redis.expire(key, seconds));
  },

  // DEL для удаления ключа
  async del(...keys) {
    return withRetry(() => redis.del(...keys));
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
    const maxIterations = 200; // Защита от бесконечного цикла (увеличено для поддержки большого количества ключей)
    
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
          console.warn(`SCAN max iterations reached: ${maxIterations} iterations, loaded ${keys.length} keys`);
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
  },

  // Redis LIST операции для хранения ошибок
  async lpush(key, ...values) {
    return withRetry(() => redis.lpush(key, ...values));
  },

  async ltrim(key, start, stop) {
    return withRetry(() => redis.ltrim(key, start, stop));
  },

  async lrange(key, start, stop) {
    return withRetry(() => redis.lrange(key, start, stop));
  },

  async llen(key) {
    return withRetry(() => redis.llen(key));
  },

  // Redis ZSET операции для индексации сессий
  async zadd(key, score, member) {
    return withRetry(() => redis.zadd(key, { score, member }));
  },

  async zrevrange(key, start, stop) {
    return withRetry(() => redis.zrevrange(key, start, stop));
  },

  async zcard(key) {
    return withRetry(() => redis.zcard(key));
  },

  async zrem(key, ...members) {
    return withRetry(() => redis.zrem(key, ...members));
  },

  // Вспомогательная функция для обновления индекса сессий
  // Вызывается при каждом сохранении сессии для быстрого поиска в админке
  async updateSessionIndex(sessionId, source, timestamp) {
    try {
      const indexKey = source === 'nm-shop' ? 'sessions:index:nm-shop' : 'sessions:index:test';
      const score = new Date(timestamp).getTime();
      await this.zadd(indexKey, score, sessionId);
      // Устанавливаем TTL на индекс (35 дней, чуть больше чем у сессий)
      await this.expire(indexKey, 35 * 24 * 60 * 60);
      return true;
    } catch (error) {
      console.error('Failed to update session index:', error.message);
      return false;
    }
  }
};

module.exports = redisClient;
