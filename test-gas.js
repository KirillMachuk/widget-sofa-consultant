// Тестовый скрипт для проверки Google Apps Script
async function testGoogleAppsScript() {
  const gasUrl = 'https://script.google.com/macros/s/AKfycbxiJrvTNiGfXTbfFWMiTWEGAyh4RKFhoKU8zjIfmQqrZlphC_vdO4R_OS9zhd-gYoZJOw/exec';
  
  const testData = {
    timestamp: new Date().toISOString(),
    name: 'Тест',
    phone: '+375291234567',
    category: 'Диван',
    gift: 'Журнальный стол в подарок',
    messenger: 'WhatsApp',
    wishes: 'Тестовое пожелание',
    pretext: 'Тестовая заявка',
    page_url: 'https://test.com',
    session_id: 'test_session_123'
  };

  try {
    console.log('Отправляем тестовые данные:', testData);
    
    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    
    const result = await response.text();
    console.log('Ответ от Google Apps Script:', result);
    console.log('Статус ответа:', response.status);
    
    if (response.ok) {
      console.log('✅ Тест успешен! Данные отправлены в Google Sheets');
    } else {
      console.log('❌ Ошибка при отправке данных');
    }
  } catch (error) {
    console.error('❌ Ошибка сети:', error);
  }
}

// Запустить тест
testGoogleAppsScript();
