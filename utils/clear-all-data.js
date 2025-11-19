// Скрипт для полной очистки всех данных из Redis
// Очищает сессии, аналитику и ошибки для обоих источников (test и nm-shop)
// Загружаем переменные окружения из .env файла, если он существует
try {
  require('dotenv').config();
} catch (e) {
  // dotenv не установлен, используем системные переменные окружения
  console.log('ℹ️  dotenv не найден, используем системные переменные окружения');
}

const redisClient = require('./redis-client');

const SOURCES = ['test', 'nm-shop'];
const ERROR_TYPES = ['widget_load_error', 'session_init_error', 'api_error', 'slow_request', 'redis_error'];

async function clearAllData() {
  console.log('🗑️  Начинаем полную очистку всех данных из Redis...\n');
  
  let totalDeleted = 0;
  const stats = {
    sessions: 0,
    analytics: 0,
    errors: 0,
    lists: 0
  };

  try {
    // 1. Очистка сессий
    console.log('📋 Очистка сессий...');
    
    for (const source of SOURCES) {
      const sessionsListKey = `sessions:list:${source}`;
      
      // Получаем список сессий для источника
      const sessionIds = await redisClient.smembers(sessionsListKey).catch(() => []);
      
      if (sessionIds && sessionIds.length > 0) {
        console.log(`  Найдено ${sessionIds.length} сессий для источника "${source}"`);
        
        // Удаляем каждую сессию
        for (const sessionId of sessionIds) {
          const chatKey = `chat:${sessionId}`;
          try {
            await redisClient.del(chatKey);
            stats.sessions++;
          } catch (error) {
            console.error(`  ⚠️  Ошибка удаления сессии ${chatKey}:`, error.message);
          }
        }
        
        // Очищаем список сессий
        await redisClient.del(sessionsListKey);
        stats.lists++;
        console.log(`  ✅ Удалено ${sessionIds.length} сессий для "${source}"`);
      } else {
        console.log(`  ℹ️  Нет сессий для источника "${source}"`);
      }
    }
    
    // Очищаем старый ключ sessions:list (для совместимости)
    const oldSessionIds = await redisClient.smembers('sessions:list').catch(() => []);
    if (oldSessionIds && oldSessionIds.length > 0) {
      console.log(`  Найдено ${oldSessionIds.length} сессий в старом списке`);
      for (const sessionId of oldSessionIds) {
        const chatKey = `chat:${sessionId}`;
        try {
          await redisClient.del(chatKey);
          stats.sessions++;
        } catch (error) {
          console.error(`  ⚠️  Ошибка удаления сессии ${chatKey}:`, error.message);
        }
      }
      await redisClient.del('sessions:list');
      stats.lists++;
      console.log(`  ✅ Удалено ${oldSessionIds.length} сессий из старого списка`);
    }
    
    console.log(`✅ Очистка сессий завершена. Удалено: ${stats.sessions} сессий\n`);

    // 2. Очистка аналитики
    console.log('📊 Очистка аналитики...');
    
    const analyticsKeys = [
      'analytics:page_view:test',
      'analytics:page_view:nm-shop',
      'analytics:widget_open:test',
      'analytics:widget_open:nm-shop',
      'analytics:form_submit:test',
      'analytics:form_submit:nm-shop'
    ];
    
    // Добавляем ключи счетчиков ошибок
    for (const errorType of ERROR_TYPES) {
      for (const source of SOURCES) {
        analyticsKeys.push(`analytics:error:${errorType}:${source}`);
      }
    }
    
    // Удаляем все ключи аналитики
    for (const key of analyticsKeys) {
      try {
        const result = await redisClient.del(key);
        if (result) {
          stats.analytics++;
        }
      } catch (error) {
        console.error(`  ⚠️  Ошибка удаления ключа ${key}:`, error.message);
      }
    }
    
    console.log(`✅ Очистка аналитики завершена. Удалено: ${stats.analytics} ключей\n`);

    // 3. Очистка ошибок
    console.log('❌ Очистка ошибок...');
    
    for (const source of SOURCES) {
      // Получаем все ключи ошибок для источника
      const errorPattern = `error:${source}:*`;
      let errorKeys = [];
      
      try {
        errorKeys = await redisClient.getAllKeys(errorPattern);
      } catch (error) {
        console.error(`  ⚠️  Ошибка получения ключей ошибок для "${source}":`, error.message);
        // Fallback на keys если getAllKeys не работает
        try {
          errorKeys = await redisClient.keys(errorPattern);
        } catch (fallbackError) {
          console.error(`  ⚠️  Fallback на keys тоже не сработал:`, fallbackError.message);
        }
      }
      
      if (errorKeys && errorKeys.length > 0) {
        console.log(`  Найдено ${errorKeys.length} ключей ошибок для источника "${source}"`);
        
        // Удаляем ключи порциями (по 100 за раз для избежания проблем с большим количеством)
        const batchSize = 100;
        for (let i = 0; i < errorKeys.length; i += batchSize) {
          const batch = errorKeys.slice(i, i + batchSize);
          try {
            await redisClient.del(...batch);
            stats.errors += batch.length;
          } catch (error) {
            console.error(`  ⚠️  Ошибка удаления батча ошибок:`, error.message);
          }
        }
        
        console.log(`  ✅ Удалено ${errorKeys.length} ключей ошибок для "${source}"`);
      } else {
        console.log(`  ℹ️  Нет ошибок для источника "${source}"`);
      }
      
      // Очищаем список ошибок
      const errorsListKey = `errors:list:${source}`;
      try {
        await redisClient.del(errorsListKey);
        stats.lists++;
        console.log(`  ✅ Очищен список ошибок для "${source}"`);
      } catch (error) {
        console.error(`  ⚠️  Ошибка очистки списка ошибок ${errorsListKey}:`, error.message);
      }
    }
    
    console.log(`✅ Очистка ошибок завершена. Удалено: ${stats.errors} ключей\n`);

    // Итоговая статистика
    totalDeleted = stats.sessions + stats.analytics + stats.errors + stats.lists;
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 ИТОГОВАЯ СТАТИСТИКА ОЧИСТКИ:');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Сессии:        ${stats.sessions}`);
    console.log(`  Аналитика:     ${stats.analytics}`);
    console.log(`  Ошибки:        ${stats.errors}`);
    console.log(`  Списки:        ${stats.lists}`);
    console.log(`  ───────────────────────────────────────────────────`);
    console.log(`  ВСЕГО:         ${totalDeleted} ключей`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n✅ Полная очистка данных завершена успешно!');
    console.log('   Все счетчики аналитики сброшены в 0.');
    console.log('   Все сессии и диалоги удалены.');
    console.log('   Все ошибки удалены.\n');

  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА при очистке данных:', error);
    console.error('   Детали:', error.message);
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  clearAllData()
    .then(() => {
      console.log('✅ Скрипт завершен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Скрипт завершен с ошибкой:', error);
      process.exit(1);
    });
}

module.exports = { clearAllData };

