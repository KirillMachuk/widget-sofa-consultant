const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

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

async function handler(req, res) {
  // Add CORS headers
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
    // Получаем sessionId из URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.pathname.split('/').pop();
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID не указан' 
      });
    }
    
    const chats = readChats();
    const session = chats.find(chat => chat.sessionId === sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        message: 'Сессия не найдена' 
      });
    }
    
    return res.status(200).json({
      success: true,
      session: {
        id: session.sessionId,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated,
        prompt: session.prompt,
        locale: session.locale,
        contacts: session.contacts || null,
        messages: session.messages || []
      }
    });
    
  } catch (error) {
    console.error('Ошибка получения сессии:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения сессии',
      error: error.message 
    });
  }
}

module.exports = handler;
