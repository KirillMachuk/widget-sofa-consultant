// Упрощенная версия api/lead.js без Redis
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
    const { gas_url, timestamp, name, phone, pretext, page_url, session_id, category, gift, messenger, wishes } = req.body || {};
    if (!gas_url) return res.status(400).json({ error: 'Missing gas_url' });
    
    const payload = { timestamp, name, phone, pretext, page_url, session_id, category, gift, messenger, wishes };
    
    // Retry логика для Google Apps Script
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
      
      try {
        console.log(`📤 Отправляем лид в GAS (попытка ${attempt}/${maxRetries})`);
        console.log('Данные:', payload);
        
        const r = await fetch(gas_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const text = await r.text();
        console.log('Ответ от GAS:', text);
        
        if (!r.ok){
          throw new Error(`GAS upstream error: ${r.status} - ${text.slice(0, 200)}`);
        }
        
        console.log(`✅ Лид успешно отправлен в GAS (попытка ${attempt})`);
        lastError = null; // Сброс ошибки при успехе
        break; // Выходим из цикла retry
        
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
    
    // Try to parse JSON, fallback to text
    try{ 
      return res.status(200).json({ ok: true, message: 'Lead saved successfully' }); 
    }
    catch(e){ 
      return res.status(200).json({ ok: true, message: 'Lead saved successfully' }); 
    }
  }catch(e){
    console.error('Ошибка в api/lead.js:', e);
    return res.status(500).json({ error: String(e) });
  }
}

module.exports = handler;
