// Health check endpoint для мониторинга состояния сервиса
const redisClient = require('../utils/redis-client');

// Проверка доступности OpenAI API
async function checkOpenAI() {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return { status: 'error', message: 'OPENAI_API_KEY not configured' };
    }
    
    // Простой запрос к OpenAI для проверки доступности
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 сек таймаут для health check
    
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return { status: 'healthy', message: 'OpenAI API accessible' };
    } else {
      return { status: 'error', message: `OpenAI API returned ${response.status}` };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { status: 'timeout', message: 'OpenAI API timeout' };
    }
    return { status: 'error', message: error.message };
  }
}

// Проверка доступности Redis
async function checkRedis() {
  try {
    const isHealthy = await redisClient.ping();
    if (isHealthy) {
      return { status: 'healthy', message: 'Redis accessible' };
    } else {
      return { status: 'error', message: 'Redis ping failed' };
    }
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

// Основной health check handler
async function handler(req, res) {
  // CORS headers
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
    const startTime = Date.now();
    
    // Параллельно проверяем все компоненты
    const [openaiStatus, redisStatus] = await Promise.all([
      checkOpenAI(),
      checkRedis()
    ]);
    
    const responseTime = Date.now() - startTime;
    
    // Определяем общий статус
    const overallStatus = 
      openaiStatus.status === 'healthy' && 
      redisStatus.status === 'healthy' ? 'healthy' : 'degraded';
    
    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      services: {
        openai: openaiStatus,
        redis: redisStatus
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime()
      }
    };
    
    // Возвращаем соответствующий HTTP статус
    const httpStatus = overallStatus === 'healthy' ? 200 : 503;
    
    return res.status(httpStatus).json(healthData);
    
  } catch (error) {
    console.error('Health check failed:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = handler;
