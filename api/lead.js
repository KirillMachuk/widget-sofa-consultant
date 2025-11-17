// Используем единый Redis клиент с retry логикой
const redis = require('../utils/redis-client');

const GAS_URL = process.env.GAS_URL;

// Сохранение контактов в Redis
async function saveContacts(sessionId, contacts) {
  try {
    console.log('💾 saveContacts: Сохраняем контакты для сессии:', sessionId);
    const chatKey = `chat:${sessionId}`;
    
    // Читаем существующую сессию
    let session = await redis.get(chatKey);
    console.log('💾 saveContacts: Сессия найдена:', !!session);
    
    if (session) {
      console.log('💾 saveContacts: Текущие контакты:', session.contacts);
      session.contacts = contacts;
      session.lastUpdated = new Date().toISOString();
      
      // Сохраняем обратно в Redis
      await redis.set(chatKey, session);
      await redis.expire(chatKey, 30 * 24 * 60 * 60); // TTL 30 дней
      console.log('✅ Контакты сохранены в Redis для сессии:', sessionId);
      console.log('✅ Сохраненные контакты:', contacts);
      return true;
    }
    console.warn('⚠️ Сессия не найдена в Redis для:', sessionId);
    return false;
  } catch (error) {
    console.error('Ошибка сохранения контактов в Redis:', error);
    return false;
  }
}

async function handler(req, res){
  console.log('📥 Получен запрос в api/lead.js:', req.method, req.url);
  
  // Add CORS headers for external domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    console.log('📤 Отправляем CORS preflight');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    console.log('❌ Неверный метод:', req.method);
    return res.status(405).end();
  }
  
  try{
    if (!GAS_URL) {
      console.error('❌ Не задан GAS_URL в переменных окружения');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }
    
    const { timestamp, name, phone, pretext, page_url, session_id, category, gift, messenger, wishes } = req.body || {};
    console.log('📊 Данные запроса:', { name, phone, category, gift, messenger, wishes });
    
    const payload = { timestamp, name, phone, pretext, page_url, session_id, category, gift, messenger, wishes };
    console.log('📦 Payload для GAS:', payload);
    // Retry логика для Google Apps Script
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 секунд таймаут для GAS
      
      try {
        console.log(`📤 Отправляем лид в GAS (попытка ${attempt}/${maxRetries})`);
        
        const r = await fetch(GAS_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
          // GAS endpoints should handle CORS themselves
        });
        
        clearTimeout(timeoutId);
        
        // GAS может возвращать разные форматы ответов
        let responseData;
        try {
          const text = await r.text();
          try {
            responseData = JSON.parse(text);
          } catch {
            // Если не JSON, проверяем текст
            if (text.includes('ok') || text.includes('success') || r.ok) {
              responseData = { ok: true };
            } else {
              responseData = { ok: false, text };
            }
          }
        } catch (parseError) {
          console.warn('Ошибка парсинга ответа GAS:', parseError);
          // Если статус 200, считаем успехом
          if (r.ok || r.status === 0) {
            responseData = { ok: true };
          } else {
            throw new Error(`GAS upstream error: ${r.status}`);
          }
        }
        
        if (responseData.ok || r.ok || r.status === 0) {
          console.log(`✅ Лид успешно отправлен в GAS (попытка ${attempt})`);
          lastError = null; // Сброс ошибки при успехе
          break; // Выходим из цикла retry
        } else {
          throw new Error(`GAS returned error: ${JSON.stringify(responseData)}`);
        }
        
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        console.error(`❌ Ошибка отправки лида (попытка ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          // Последняя попытка неудачна
          if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Request timeout to Google Apps Script' });
          }
          return res.status(502).json({ error: 'GAS upstream error', details: error.message });
        }
        
        // Экспоненциальная задержка: 1s, 2s
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.log(`⏳ Повторная попытка через ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    if (lastError) {
      return res.status(502).json({ error: 'All retry attempts failed', details: lastError.message });
    }
    
    // Сохраняем контакты ПОСЛЕ успешного ответа от GAS
    if (session_id) {
      await saveContacts(session_id, {
        name: name || '',
        phone: phone || '',
        pretext: pretext || '',
        page_url: page_url || '',
        category: category || '',
        gift: gift || '',
        messenger: messenger || '',
        wishes: wishes || '',
        timestamp: timestamp || new Date().toISOString()
      });
    }
    
    // Try to parse JSON, fallback to text
    try{ 
      return res.status(200).json({ ok: true, message: 'Lead saved successfully' }); 
    }
    catch(e){ 
      return res.status(200).json({ ok: true, message: 'Lead saved successfully' }); 
    }
  }catch(e){
    return res.status(500).json({ error: String(e) });
  }
}

module.exports = handler;