async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log('Получен запрос авторизации:', req.method, req.url);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Парсим body если он строка
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('Ошибка парсинга JSON:', e);
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }
    
    const { login, password } = body || {};
    console.log('Извлеченные данные:', { login, password });
    
    // Простая проверка логина/пароля
    if (login === 'admin' && password === 'admin') {
      // Генерируем простой токен (в продакшене лучше использовать JWT)
      const token = Buffer.from(`${login}:${Date.now()}`).toString('base64');
      
      return res.status(200).json({ 
        success: true, 
        token,
        message: 'Авторизация успешна' 
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Неверный логин или пароль' 
      });
    }
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Внутренняя ошибка сервера' 
    });
  }
}

module.exports = handler;
