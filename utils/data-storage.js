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

// Добавляем или обновляем сессию
function upsertSession(sessionId, sessionData) {
  const chats = readChats();
  const existingIndex = chats.findIndex(chat => chat.sessionId === sessionId);
  
  const sessionRecord = {
    sessionId,
    ...sessionData,
    lastUpdated: new Date().toISOString()
  };
  
  if (existingIndex >= 0) {
    chats[existingIndex] = { ...chats[existingIndex], ...sessionRecord };
  } else {
    chats.push(sessionRecord);
  }
  
  return saveChats(chats);
}

// Добавляем сообщение к сессии
function addMessage(sessionId, message) {
  const chats = readChats();
  const sessionIndex = chats.findIndex(chat => chat.sessionId === sessionId);
  
  if (sessionIndex >= 0) {
    if (!chats[sessionIndex].messages) {
      chats[sessionIndex].messages = [];
    }
    chats[sessionIndex].messages.push({
      ...message,
      timestamp: new Date().toISOString()
    });
    chats[sessionIndex].lastUpdated = new Date().toISOString();
  } else {
    // Создаем новую сессию
    chats.push({
      sessionId,
      messages: [{
        ...message,
        timestamp: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    });
  }
  
  return saveChats(chats);
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

module.exports = {
  readChats,
  saveChats,
  upsertSession,
  addMessage,
  updateSessionContacts,
  getSessions
};
