// Простой тест для проверки работы каталога
// Запуск: node test-catalog.js

const catalogHandler = require('./api/catalog');

// Симуляция запроса к каталогу
async function testCatalog() {
  console.log('🧪 Тестирование каталога...\n');
  
  try {
    // Тест 1: Поиск диванов
    console.log('1️⃣ Тест поиска диванов:');
    const sofaRequest = {
      method: 'POST',
      body: JSON.stringify({
        action: 'search',
        query: 'диван серый',
        filters: { limit: 5 }
      })
    };
    
    const mockReq = {
      method: 'POST',
      body: JSON.stringify({
        action: 'search',
        query: 'диван серый',
        filters: { limit: 5 }
      })
    };
    
    const mockRes = {
      status: (code) => ({ json: (data) => console.log(`Статус: ${code}`, data) }),
      setHeader: () => {},
      json: (data) => console.log('Результат:', data)
    };
    
    await catalogHandler(mockReq, mockRes);
    
    console.log('\n✅ Тест завершен успешно!');
    
  } catch (error) {
    console.error('❌ Ошибка теста:', error.message);
  }
}

// Запуск теста
testCatalog();
