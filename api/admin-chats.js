const { getSessions } = require('../utils/data-storage');

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
    let filters = {};
    
    if (req.method === 'GET') {
      // Получаем параметры из query string
      const url = new URL(req.url, `http://${req.headers.host}`);
      filters = {
        dateFrom: url.searchParams.get('dateFrom'),
        dateTo: url.searchParams.get('dateTo'),
        hasContacts: url.searchParams.get('hasContacts') === 'true' ? true : 
                     url.searchParams.get('hasContacts') === 'false' ? false : undefined,
        search: url.searchParams.get('search')
      };
    } else if (req.method === 'POST') {
      // Получаем параметры из body
      filters = req.body || {};
    }
    
    // Убираем пустые значения
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || filters[key] === null || filters[key] === '') {
        delete filters[key];
      }
    });
    
    const sessions = getSessions(filters);
    
    // Форматируем данные для фронтенда
    const formattedSessions = sessions.map(session => ({
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
}

module.exports = handler;
