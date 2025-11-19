// Скрипт для очистки старых сессий из Redis
// Использование: node utils/clear-old-sessions.js
const redis = require('./redis-client');

async function clearOldSessions() {
  try {
    console.log('🔍 Начинаем очистку старых сессий из Redis...');
    
    // Получаем все ключи сессий
    const sessionKeys = await redis.getAllKeys('chat:*');
    console.log(`📊 Найдено ${sessionKeys.length} сессий в Redis`);
    
    // Получаем списки сессий
    const sessionsListTest = await redis.smembers('sessions:list:test');
    const sessionsListNmShop = await redis.smembers('sessions:list:nm-shop');
    const sessionsListOld = await redis.smembers('sessions:list'); // Старый формат
    
    const totalInLists = (sessionsListTest?.length || 0) + 
                         (sessionsListNmShop?.length || 0) + 
                         (sessionsListOld?.length || 0);
    console.log(`📊 Найдено в списках: test=${sessionsListTest?.length || 0}, nm-shop=${sessionsListNmShop?.length || 0}, old=${sessionsListOld?.length || 0}`);
    
    // Удаляем все сессии
    if (sessionKeys.length > 0) {
      // Redis DEL может принять максимум определенное количество ключей за раз
      // Разбиваем на батчи по 100 ключей
      const batchSize = 100;
      for (let i = 0; i < sessionKeys.length; i += batchSize) {
        const batch = sessionKeys.slice(i, i + batchSize);
        await redis.del(...batch);
        console.log(`🗑️  Удалено ${Math.min(batchSize, sessionKeys.length - i)} сессий (батч ${Math.floor(i / batchSize) + 1})`);
      }
    }
    
    // Удаляем списки сессий
    if (sessionsListTest && sessionsListTest.length > 0) {
      await redis.del('sessions:list:test');
      console.log('🗑️  Удален список sessions:list:test');
    }
    if (sessionsListNmShop && sessionsListNmShop.length > 0) {
      await redis.del('sessions:list:nm-shop');
      console.log('🗑️  Удален список sessions:list:nm-shop');
    }
    if (sessionsListOld && sessionsListOld.length > 0) {
      await redis.del('sessions:list');
      console.log('🗑️  Удален старый список sessions:list');
    }
    
    console.log('✅ Все старые сессии удалены из Redis');
    
  } catch (error) {
    console.error('❌ Ошибка при очистке сессий:', error);
    throw error;
  }
}

// Запускаем очистку
if (require.main === module) {
  clearOldSessions()
    .then(() => {
      console.log('✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = { clearOldSessions };

