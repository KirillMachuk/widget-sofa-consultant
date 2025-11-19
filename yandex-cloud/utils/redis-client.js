// Единый Redis клиент для Yandex Managed Service for Redis
const Redis = require('ioredis');

// Создаем единственный экземпляр Redis клиента
let redis = null;

function getRedisClient() {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true
    });

    redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redis.on('connect', () => {
      console.log('Redis connected');
    });
  }
  return redis;
}

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
  // ioredis автоматически сериализует/десериализует JSON
  async get(key) {
    const client = getRedisClient();
    return Promise.race([
      withRetry(async () => {
        const value = await client.get(key);
        // ioredis возвращает строку, нужно парсить JSON вручную
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch (e) {
          // Если не JSON, возвращаем как есть (для числовых значений)
          return value;
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis GET timeout after 10s')), 10000)
      )
    ]);
  },

  // SET с retry
  async set(key, value, options = {}) {
    const client = getRedisClient();
    return Promise.race([
      withRetry(async () => {
        const serialized = JSON.stringify(value);
        if (options.EX) {
          return await client.setex(key, options.EX, serialized);
        }
        return await client.set(key, serialized);
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis SET timeout after 10s')), 10000)
      )
    ]);
  },

  // SETEX с retry
  async setex(key, seconds, value) {
    const client = getRedisClient();
    return withRetry(async () => {
      const serialized = JSON.stringify(value);
      return await client.setex(key, seconds, serialized);
    });
  },

  // MGET с retry и логированием
  async mget(...keys) {
    const client = getRedisClient();
    console.log('🔍 redisClient.mget: Запрос для', keys.length, 'ключей');
    const results = await Promise.race([
      withRetry(async () => {
        const values = await client.mget(...keys);
        return values.map(v => {
          if (!v) return null;
          try {
            return JSON.parse(v);
          } catch (e) {
            return v;
          }
        });
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis MGET timeout after 15s')), 15000)
      )
    ]);
    console.log('✅ redisClient.mget: Получено', results ? results.length : 0, 'результатов');
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
    const client = getRedisClient();
    return withRetry(() => client.incr(key));
  },

  // Redis SET операции
  async sadd(key, ...members) {
    const client = getRedisClient();
    return withRetry(() => client.sadd(key, ...members));
  },

  async smembers(key) {
    const client = getRedisClient();
    return withRetry(() => client.smembers(key));
  },

  async srem(key, ...members) {
    const client = getRedisClient();
    return withRetry(() => client.srem(key, ...members));
  },

  // EXPIRE для установки TTL
  async expire(key, seconds) {
    const client = getRedisClient();
    return withRetry(() => client.expire(key, seconds));
  },

  // DEL для удаления ключа
  async del(...keys) {
    const client = getRedisClient();
    return withRetry(() => client.del(...keys));
  },

  // SCAN для безопасного получения ключей
  async scan(cursor = 0, match = '*', count = 100) {
    const client = getRedisClient();
    return withRetry(() => client.scan(cursor, 'MATCH', match, 'COUNT', count), 3, 1000);
  },

  // KEYS - старая блокирующая команда (не рекомендуется для production)
  async keys(pattern = '*') {
    const client = getRedisClient();
    return withRetry(() => client.keys(pattern), 1, 5000);
  },

  // Получить все ключи с помощью SCAN (неблокирующая операция)
  async getAllKeys(pattern = '*', batchSize = 100) {
    const client = getRedisClient();
    const keys = [];
    let cursor = 0;
    let iterations = 0;
    const maxIterations = 100;
    
    try {
      do {
        const result = await Promise.race([
          this.scan(cursor, pattern, batchSize),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('SCAN timeout')), 5000)
          )
        ]);
        
        if (Array.isArray(result)) {
          cursor = parseInt(result[0]);
          keys.push(...result[1]);
        } else if (result && typeof result === 'object') {
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
      const client = getRedisClient();
      await withRetry(() => client.ping(), 1, 500);
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

