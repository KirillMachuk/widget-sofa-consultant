// Используем единый Redis клиент с retry логикой
const redis = require('../utils/redis-client');

const GAS_URL = process.env.GAS_URL;

// Сохранение контактов в Redis
async function saveContacts(sessionId, contacts) {
  try {
    console.log('💾 saveContacts: Сохраняем контакты для сессии:', sessionId);
    const chatKey = `chat:${sessionId}`;
    
    // Определяем источник из page_url
    const source = contacts.page_url && contacts.page_url.includes('nm-shop.by') ? 'nm-shop' : 'test';
    const sessionsListKey = source === 'nm-shop' ? 'sessions:list:nm-shop' : 'sessions:list:test';
    
    // Читаем существующую сессию
    let session = await redis.get(chatKey);
    console.log('💾 saveContacts: Сессия найдена:', !!session);
    
    if (session) {
      console.log('💾 saveContacts: Текущие контакты:', session.contacts);
      session.contacts = contacts;
      session.source = source; // Сохраняем источник
      session.lastUpdated = new Date().toISOString();
      
      // Сохраняем обратно в Redis
      await redis.setex(chatKey, 30 * 24 * 60 * 60, session); // TTL 30 дней
      // Добавляем в соответствующий список сессий
      await redis.sadd(sessionsListKey, sessionId);
      // Обновляем индекс для быстрого поиска
      await redis.updateSessionIndex(sessionId, source, session.lastUpdated);
      console.log('✅ Контакты сохранены в Redis для сессии:', sessionId, 'источник:', source);
      console.log('✅ Сохраненные контакты:', contacts);
      return true;
    } else {
      // Создаем новую сессию если её нет
      console.log('⚠️ Сессия не найдена, создаем новую с контактами');
      session = {
        sessionId: sessionId,
        source: source,
        contacts: contacts,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messages: []
      };
      await redis.setex(chatKey, 30 * 24 * 60 * 60, session);
      await redis.sadd(sessionsListKey, sessionId);
      // Добавляем в индекс для быстрого поиска
      await redis.updateSessionIndex(sessionId, source, session.createdAt);
      console.log('✅ Новая сессия создана с контактами, источник:', source);
      return true;
    }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Pragma');
  
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
        console.log('🔗 GAS URL:', GAS_URL ? GAS_URL.substring(0, 50) + '...' : 'НЕ ЗАДАН');
        console.log('📦 Полный payload:', JSON.stringify(payload, null, 2));
        
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
        
        console.log('📥 Ответ от GAS получен:', {
          status: r.status,
          statusText: r.statusText,
          ok: r.ok,
          headers: Object.fromEntries(r.headers.entries())
        });
        
        // GAS может возвращать разные форматы ответов
        let responseData;
        let responseText = '';
        try {
          responseText = await r.text();
          console.log('📄 Текст ответа от GAS:', responseText.substring(0, 500));
          
          try {
            responseData = JSON.parse(responseText);
            console.log('✅ JSON ответ от GAS распарсен:', responseData);
          } catch (parseError) {
            console.warn('⚠️ Ответ не JSON, пытаемся определить успех по тексту');
            // Если не JSON, проверяем текст
            if (responseText.includes('ok') || responseText.includes('success') || responseText.includes('true') || r.ok) {
              responseData = { ok: true, text: responseText };
              console.log('✅ Определен как успех по тексту');
            } else {
              responseData = { ok: false, text: responseText };
              console.log('❌ Определен как ошибка по тексту');
            }
          }
        } catch (parseError) {
          console.error('❌ Ошибка чтения ответа GAS:', parseError);
          // Если статус 200, считаем успехом
          if (r.ok || r.status === 0) {
            responseData = { ok: true };
            console.log('✅ Статус 200, считаем успехом');
          } else {
            console.error('❌ Статус не 200:', r.status);
            throw new Error(`GAS upstream error: ${r.status}`);
          }
        }
        
        if (responseData.ok || r.ok || r.status === 0) {
          console.log(`✅✅✅ Лид успешно отправлен в GAS (попытка ${attempt})`);
          console.log('📊 Детали успешной отправки:', {
            status: r.status,
            statusText: r.statusText,
            responseData: responseData,
            responseText: responseText.substring(0, 200),
            payload: { name, phone, category, gift, messenger, page_url }
          });
          lastError = null; // Сброс ошибки при успехе
          break; // Выходим из цикла retry
        } else {
          console.error('❌❌❌ GAS вернул ошибку:', { 
            status: r.status, 
            statusText: r.statusText,
            responseData: responseData,
            responseText: responseText.substring(0, 500)
          });
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
      console.error('❌❌❌ Все попытки отправки в GAS неудачны:', lastError);
      return res.status(502).json({ error: 'All retry attempts failed', details: lastError.message });
    }
    
    console.log('✅✅✅ УСПЕХ: Лид успешно отправлен в GAS после всех попыток');
    
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