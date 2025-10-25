// API для ручного обновления каталога
const { kv } = require('@vercel/kv');
const catalogHandler = require('./catalog');

async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Проверка безопасности - только POST с секретным ключом
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CATALOG_UPDATE_SECRET || 'default-secret-change-me';
  
  if (authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Принудительно очищаем кеш
    await kv.del('catalog:main');
    await kv.del('catalog:metadata');
    
    console.log('🔄 Принудительное обновление каталога...');
    
    // Создаём mock request для catalog.js
    const catalogReq = {
      method: 'POST',
      body: { action: 'stats' }
    };
    
    let result = null;
    const catalogRes = {
      setHeader: () => {},
      status: (code) => ({
        json: (data) => { result = data; },
        end: () => {}
      })
    };
    
    await catalogHandler(catalogReq, catalogRes);
    
    return res.status(200).json({
      success: true,
      message: 'Catalog updated successfully',
      ...result
    });
  } catch (error) {
    console.error('❌ Ошибка обновления каталога:', error);
    return res.status(500).json({
      error: 'Failed to update catalog',
      message: error.message
    });
  }
}

module.exports = handler;


