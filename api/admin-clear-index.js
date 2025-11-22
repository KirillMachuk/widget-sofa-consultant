// API endpoint для очистки ZSET индексов
const redisClient = require('../utils/redis-client');

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
    console.log('🧹 Начинаем очистку ZSET индексов...');
    
    // Удаляем индексы для обоих источников
    const keys = ['sessions:index:nm-shop', 'sessions:index:test'];
    const results = [];
    
    for (const key of keys) {
      const count = await redisClient.zcard(key);
      console.log(`📊 Индекс '${key}' содержит ${count} записей`);
      
      if (count > 0) {
        await redisClient.del(key);
        console.log(`✅ Индекс '${key}' очищен`);
        results.push({ key, before: count, status: 'cleared' });
      } else {
        console.log(`ℹ️ Индекс '${key}' уже пуст`);
        results.push({ key, before: 0, status: 'already_empty' });
      }
    }
    
    console.log('✅ Очистка завершена! Индексы будут заново заполнены только сессиями с сообщениями/контактами.');
    
    return res.status(200).json({
      success: true,
      message: 'Индексы успешно очищены',
      results
    });
    
  } catch (error) {
    console.error('❌ Ошибка очистки индексов:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка очистки индексов',
      error: error.message 
    });
  }
};

