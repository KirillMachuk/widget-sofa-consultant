// Детальный тест каталога для диагностики проблем
// Запуск: node test-catalog-detailed.js

async function testCatalogDetailed() {
  console.log('🧪 Детальное тестирование каталога...\n');
  
  try {
    // Шаг 1: Проверка доступности каталога
    console.log('1️⃣ Проверка доступности каталога nm-shop.by...');
    const CATALOG_URL = 'https://nm-shop.by/index.php?route=extension/feed/yandex_yml_cht';
    
    const response = await fetch(CATALOG_URL);
    console.log('   Статус:', response.status);
    console.log('   Content-Type:', response.headers.get('content-type'));
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const xmlText = await response.text();
    console.log('   Размер каталога:', Math.round(xmlText.length / 1024), 'KB');
    
    // Шаг 2: Проверка структуры XML
    console.log('\n2️⃣ Анализ структуры каталога...');
    const offerMatches = xmlText.match(/<offer[^>]*>/g);
    console.log('   Найдено офферов:', offerMatches ? offerMatches.length : 0);
    
    // Шаг 3: Поиск по ключевым словам
    console.log('\n3️⃣ Поиск по ключевым словам...');
    const keywords = ['диван', 'еврокнижка', 'кресло', 'подвесное'];
    keywords.forEach(keyword => {
      const count = (xmlText.toLowerCase().match(new RegExp(keyword, 'g')) || []).length;
      console.log(`   "${keyword}": ${count} упоминаний`);
    });
    
    // Шаг 4: Тестируем парсинг
    console.log('\n4️⃣ Тестирование парсинга...');
    const catalogModule = require('./api/catalog');
    
    // Создаем mock для req/res
    const mockReq = {
      method: 'POST',
      body: {
        action: 'search',
        query: 'диван еврокнижка',
        filters: { limit: 5 }
      }
    };
    
    const results = [];
    const mockRes = {
      setHeader: () => {},
      status: (code) => ({
        json: (data) => {
          console.log('   Статус ответа:', code);
          console.log('   Найдено товаров:', data.totalFound || 0);
          if (data.offers && data.offers.length > 0) {
            console.log('   Примеры товаров:');
            data.offers.slice(0, 3).forEach((offer, i) => {
              console.log(`   ${i+1}. ${offer.name} - ${offer.price} ${offer.currency}`);
            });
          }
          results.push(data);
        },
        end: () => {}
      }),
      json: (data) => {
        console.log('   Статус ответа: 200');
        console.log('   Найдено товаров:', data.totalFound || 0);
        if (data.offers && data.offers.length > 0) {
          console.log('   Примеры товаров:');
          data.offers.slice(0, 3).forEach((offer, i) => {
            console.log(`   ${i+1}. ${offer.name} - ${offer.price} ${offer.currency}`);
          });
        }
        results.push(data);
      }
    };
    
    await catalogModule(mockReq, mockRes);
    
    console.log('\n✅ Тест завершен!');
    
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error('Стек:', error.stack);
  }
}

// Запуск
testCatalogDetailed().catch(console.error);

