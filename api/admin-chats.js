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

// Получаем все сессии с фильтрацией
function getSessions(filters = {}) {
  console.log('getSessions вызвана с фильтрами:', filters);
  let chats = readChats();
  console.log('Прочитано чатов:', chats.length);
  
  // Фильтр по дате
  if (filters.dateFrom) {
    chats = chats.filter(chat => new Date(chat.createdAt) >= new Date(filters.dateFrom));
  }
  if (filters.dateTo) {
    chats = chats.filter(chat => new Date(chat.createdAt) <= new Date(filters.dateTo));
  }
  
  // Фильтр по наличию контактов
  if (filters.hasContacts !== undefined) {
    if (filters.hasContacts) {
      chats = chats.filter(chat => chat.contacts && (chat.contacts.name || chat.contacts.phone));
    } else {
      chats = chats.filter(chat => !chat.contacts || (!chat.contacts.name && !chat.contacts.phone));
    }
  }
  
  // Поиск по сообщениям
  if (filters.search) {
    const searchTerm = filters.search.toLowerCase();
    chats = chats.filter(chat => {
      if (!chat.messages) return false;
      return chat.messages.some(msg => 
        msg.content && msg.content.toLowerCase().includes(searchTerm)
      );
    });
  }
  
  // Сортировка по дате (новые сверху)
  chats.sort((a, b) => new Date(b.lastUpdated || b.createdAt) - new Date(a.lastUpdated || a.createdAt));
  
  return chats;
}

async function handler(req, res) {
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
    
    // Пока возвращаем пустой массив для тестирования
    const formattedSessions = [];
    
    return res.status(200).json({
      success: true,
      sessions: formattedSessions,
      total: formattedSessions.length,
      message: 'API работает, но пока нет данных'
    });
    
  } catch (error) {
    console.error('Ошибка получения диалогов:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка получения диалогов',
      error: error.message 
    });
  }
}

module.exports = handler;
