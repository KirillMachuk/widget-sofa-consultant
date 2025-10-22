// Тест реального API каталога
// Запуск: node test-catalog-api.js

async function testCatalogAPI() {
  console.log('🧪 Тестирование API каталога...\n');
  
  try {
    // Имитируем реальный запрос к API
    const catalogModule = require('./api/catalog');
    
    // Создаем правильный mock для req/res
    const mockReq = {
      method: 'POST',
      body: JSON.stringify({
        action: 'search',
        query: 'диван еврокнижка',
        filters: { limit: 5 }
      })
    };
    
    // Парсим body как в реальном API
    mockReq.body = JSON.parse(mockReq.body);
    
    let responseData = null;
    const mockRes = {
      setHeader: () => {},
      status: (code) => ({
        json: (data) => {
          responseData = data;
          console.log('📊 Результат API каталога:');
          console.log('   success:', data.success);
          console.log('   totalFound:', data.totalFound);
          console.log('   formattedForGPT length:', data.formattedForGPT ? data.formattedForGPT.length : 'null');
          console.log('   offers count:', data.offers ? data.offers.length : 'null');
          
          if (data.formattedForGPT) {
            console.log('\n📝 Форматированные товары для GPT:');
            console.log(data.formattedForGPT);
          }
          
          if (data.offers && data.offers.length > 0) {
            console.log('\n🛋️ Примеры товаров:');
            data.offers.slice(0, 3).forEach((offer, i) => {
              console.log(`   ${i+1}. ${offer.name} - ${offer.price} ${offer.currency}`);
            });
          }
        },
        end: () => {}
      }),
      json: (data) => {
        responseData = data;
        console.log('📊 Результат API каталога (200):');
        console.log('   success:', data.success);
        console.log('   totalFound:', data.totalFound);
        console.log('   formattedForGPT length:', data.formattedForGPT ? data.formattedForGPT.length : 'null');
        console.log('   offers count:', data.offers ? data.offers.length : 'null');
        
        if (data.formattedForGPT) {
          console.log('\n📝 Форматированные товары для GPT:');
          console.log(data.formattedForGPT);
        }
      }
    };
    
    await catalogModule(mockReq, mockRes);
    
    console.log('\n✅ Тест API завершен!');
    
  } catch (error) {
    console.error('\n❌ Ошибка API:', error.message);
    console.error('Стек:', error.stack);
  }
}

// Запуск
testCatalogAPI().catch(console.error);
