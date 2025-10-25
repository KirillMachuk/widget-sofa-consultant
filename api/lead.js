// Используем тот же Redis клиент что и для каталога
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Сохранение контактов в Redis
async function saveContacts(sessionId, contacts) {
  try {
    const chatKey = `chat:${sessionId}`;
    
    // Читаем существующую сессию
    let session = await redis.get(chatKey);
    if (session) {
      session.contacts = contacts;
      session.lastUpdated = new Date().toISOString();
      
      // Сохраняем обратно в Redis
      await redis.set(chatKey, session);
      console.log('Контакты сохранены в Redis для сессии:', sessionId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Ошибка сохранения контактов в Redis:', error);
    return false;
  }
}

async function handler(req, res){
  // Add CORS headers for external domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') return res.status(405).end();
  try{
    const { gas_url, timestamp, name, phone, pretext, page_url, session_id } = req.body || {};
    if (!gas_url) return res.status(400).json({ error: 'Missing gas_url' });
    const payload = { timestamp, name, phone, pretext, page_url, session_id };
    // Добавляем таймаут для запроса к Google Apps Script
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 секунд таймаут

    try {
      const r = await fetch(gas_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const text = await r.text();
      if (!r.ok){
        return res.status(502).json({ error: 'GAS upstream error', status: r.status, body: text.slice(0, 500) });
      }
      
      // Сохраняем контакты ПОСЛЕ успешного ответа от GAS
      if (session_id) {
        await saveContacts(session_id, {
          name: name || '',
          phone: phone || '',
          pretext: pretext || '',
          page_url: page_url || '',
          timestamp: timestamp || new Date().toISOString()
        });
      }
      
      // Try to parse JSON, fallback to text
      try{ return res.status(200).json(JSON.parse(text)); }
      catch(e){ return res.status(200).json({ ok: true, upstream: text.slice(0, 200) }); }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return res.status(504).json({ error: 'Request timeout to Google Apps Script' });
      }
      return res.status(500).json({ error: String(error) });
    }
  }catch(e){
    return res.status(500).json({ error: String(e) });
  }
}

module.exports = handler;