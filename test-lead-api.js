// Тест api/lead.js напрямую
const http = require('http');

const testData = {
  gas_url: 'https://script.google.com/macros/s/AKfycbxiJrvTNiGfXTbfFWMiTWEGAyh4RKFhoKU8zjIfmQqrZlphC_vdO4R_OS9zhd-gYoZJOw/exec',
  timestamp: new Date().toISOString(),
  name: 'Тест API Lead',
  phone: '+375291234567',
  category: 'Кровать',
  gift: 'Подъемный механизм в подарок',
  messenger: 'Telegram',
  wishes: 'Тестовое пожелание через API',
  pretext: 'Запрос подборки мебели с подарком',
  page_url: 'https://test-api.com',
  session_id: 'test_api_session_789'
};

const postData = JSON.stringify(testData);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/lead',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Отправляем данные через api/lead.js:', testData);

const req = http.request(options, (res) => {
  console.log(`Статус ответа: ${res.statusCode}`);
  console.log(`Заголовки ответа:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Ответ от api/lead.js:', data);
    if (res.statusCode === 200) {
      console.log('✅ Тест API успешен! Данные отправлены в Google Sheets');
    } else {
      console.log('❌ Ошибка при отправке данных через API');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Ошибка запроса:', e.message);
  console.log('💡 Убедитесь, что сервер запущен на порту 3000');
});

req.write(postData);
req.end();
