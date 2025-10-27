// Тест отправки данных через api/lead.js (как в реальном виджете)
const CONFIG = {
  gasEndpoint: 'https://script.google.com/macros/s/AKfycbxiJrvTNiGfXTbfFWMiTWEGAyh4RKFhoKU8zjIfmQqrZlphC_vdO4R_OS9zhd-gYoZJOw/exec'
};

async function testWidgetSubmission() {
  const testData = {
    gas_url: CONFIG.gasEndpoint,
    timestamp: new Date().toISOString(),
    name: 'Тест Виджет',
    phone: '+375291234567',
    category: 'Кровать',
    gift: 'Подъемный механизм в подарок',
    messenger: 'Telegram',
    wishes: 'Тестовое пожелание от виджета',
    pretext: 'Запрос подборки мебели с подарком',
    page_url: 'https://test-widget.com',
    session_id: 'test_widget_session_456'
  };

  try {
    console.log('Отправляем данные через api/lead.js:', testData);
    
    const response = await fetch('http://localhost:3000/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    
    const result = await response.text();
    console.log('Ответ от api/lead.js:', result);
    console.log('Статус ответа:', response.status);
    
    if (response.ok) {
      console.log('✅ Тест виджета успешен! Данные отправлены в Google Sheets');
    } else {
      console.log('❌ Ошибка при отправке данных через api/lead.js');
    }
  } catch (error) {
    console.error('❌ Ошибка сети при тестировании виджета:', error);
    console.log('💡 Убедитесь, что сервер запущен: npm start');
  }
}

// Запустить тест
testWidgetSubmission();
