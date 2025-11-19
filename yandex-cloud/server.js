// Express сервер для локальной разработки Yandex Cloud версии виджета
const express = require('express');
const path = require('path');

// Загрузка переменных окружения из .env файла (если есть)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv не установлен, используем системные переменные окружения
  console.log('dotenv не найден, используем системные переменные окружения');
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware для парсинга JSON
app.use(express.json());

// CORS middleware для всех запросов
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Статические файлы
app.use(express.static(path.join(__dirname)));

// API endpoints
app.use('/api/chat', require('./api/chat'));
app.use('/api/lead', require('./api/lead'));
app.use('/api/analytics', require('./api/analytics'));
app.use('/api/health', require('./api/health'));

// Корневой маршрут для тестирования
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <title>Yandex Cloud Widget - Local Test</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
    </head>
    <body>
      <h1>Yandex Cloud Widget - Local Development Server</h1>
      <p>Сервер запущен на порту ${PORT}</p>
      <h2>Endpoints:</h2>
      <ul>
        <li><a href="/api/health">/api/health</a> - Health check</li>
        <li><a href="/widget-external.js">/widget-external.js</a> - Widget script</li>
        <li><a href="/Промпт.json">/Промпт.json</a> - Prompt configuration</li>
        <li><a href="/images/consultant.jpg">/images/consultant.jpg</a> - Consultant image</li>
      </ul>
      <h2>Тест виджета:</h2>
      <script>
        (function(){
          var s=document.createElement('script');
          s.src='http://localhost:${PORT}/widget-external.js?v=' + Date.now();
          s.defer=true;
          s.dataset.prompt='http://localhost:${PORT}/Промпт.json';
          s.dataset.api='http://localhost:${PORT}/api/chat';
          s.dataset.gas='https://script.google.com/macros/s/AKfycbxiJrvTNiGfXTbfFWMiTWEGAyh4RKFhoKU8zjIfmQqrZlphC_vdO4R_OS9zhd-gYoZJOw/exec';
          document.head.appendChild(s);
        })();
      </script>
    </body>
    </html>
  `);
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Yandex Cloud Widget server running on http://localhost:${PORT}`);
  console.log(`📝 API endpoints available at http://localhost:${PORT}/api/*`);
  console.log(`📦 Widget script: http://localhost:${PORT}/widget-external.js`);
  console.log(`\n⚠️  Убедитесь, что переменные окружения настроены в .env файле`);
});

