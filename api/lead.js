// Встроенные функции для работы с данными
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Создаем директорию data если не существует
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Читаем данные из файла
function readChats() {
  try {
    if (!fs.existsSync(CHATS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(CHATS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка чтения файла чатов:', error);
    return [];
  }
}

// Сохраняем данные в файл
function saveChats(chats) {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Ошибка сохранения файла чатов:', error);
    return false;
  }
}

// Обновляем контактные данные сессии
function updateSessionContacts(sessionId, contacts) {
  const chats = readChats();
  const sessionIndex = chats.findIndex(chat => chat.sessionId === sessionId);
  
  if (sessionIndex >= 0) {
    chats[sessionIndex].contacts = contacts;
    chats[sessionIndex].lastUpdated = new Date().toISOString();
    return saveChats(chats);
  }
  
  return false;
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
      
      // Сохраняем контактные данные к сессии ПОСЛЕ успешного ответа от GAS
      if (session_id) {
        try {
          updateSessionContacts(session_id, {
            name: name || '',
            phone: phone || '',
            pretext: pretext || '',
            page_url: page_url || '',
            timestamp: timestamp || new Date().toISOString()
          });
          console.log('Контакты сохранены для сессии:', session_id);
        } catch (error) {
          console.error('Ошибка сохранения контактов:', error);
        }
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