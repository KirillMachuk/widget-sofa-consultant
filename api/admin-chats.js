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

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log('Запрос к admin-chats:', req.method, req.url);
    
    // Читаем реальные данные
    const chats = readChats();
    console.log('Найдено чатов:', chats.length);
    
    // Форматируем данные для фронтенда
    const formattedSessions = chats.map(session => ({
      id: session.sessionId,
      createdAt: session.createdAt,
      lastUpdated: session.lastUpdated,
      prompt: session.prompt,
      locale: session.locale,
      contacts: session.contacts || null,
      messageCount: session.messages ? session.messages.length : 0,
      lastMessage: session.messages && session.messages.length > 0 
        ? session.messages[session.messages.length - 1] 
        : null,
      hasContacts: !!(session.contacts && (session.contacts.name || session.contacts.phone))
    }));
    
    return res.status(200).json({
      success: true,
      sessions: formattedSessions,
      total: formattedSessions.length
    });
    
  } catch (error) {
    console.error('Ошибка получения диалогов:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения диалогов',
      error: error.message 
    });
  }
};