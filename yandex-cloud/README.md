# Widget для Yandex Cloud

Изолированная версия виджета для развертывания на Yandex Cloud. Эта версия полностью независима от основной версии на Vercel.

## Структура

- `api/` - API endpoints (chat, lead, analytics, health)
- `utils/` - Утилиты (Redis клиент для Yandex Managed Redis, rate limiter)
- `images/` - Статические изображения
- `widget-external.js` - Клиентский скрипт виджета
- `Промпт.json` - Конфигурация промпта для бота
- `server.js` - Express сервер для локальной разработки
- `package.json` - Зависимости проекта

## Локальная разработка

### Установка зависимостей

```bash
cd yandex-cloud
npm install
```

### Настройка переменных окружения

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Заполните переменные:
- `OPENAI_API_KEY` - ключ OpenAI API
- `REDIS_HOST` - хост Yandex Managed Redis
- `REDIS_PORT` - порт Redis (обычно 6379)
- `REDIS_PASSWORD` - пароль Redis

### Запуск локального сервера

```bash
npm start
```

Сервер запустится на `http://localhost:3001`

### Тестирование виджета локально

Откройте `http://localhost:3001` в браузере - там будет тестовая страница с виджетом.

## Деплой в Yandex Cloud

### Автоматический деплой через GitHub Actions

При каждом push в ветку `main`, если изменены файлы в `yandex-cloud/`, автоматически запускается деплой.

**Требуемые GitHub Secrets:**
- `YC_SERVICE_ACCOUNT_KEY` - JSON ключ сервисного аккаунта
- `YC_CLOUD_ID` - ID облака
- `YC_FOLDER_ID` - ID папки
- `OBJECT_STORAGE_BUCKET` - имя bucket в Object Storage
- `OPENAI_API_KEY` - ключ OpenAI
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - данные Redis

### Ручной деплой

```bash
cd yandex-cloud
./deploy-yandex.sh
```

Убедитесь, что установлены переменные окружения:
- `YC_CLOUD_ID`
- `YC_FOLDER_ID`
- `OPENAI_API_KEY`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `OBJECT_STORAGE_BUCKET`

## Интеграция на сайтах клиентов

После деплоя используйте следующий код для интеграции:

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://storage.yandexcloud.net/YOUR-BUCKET/widget-external.js';
    s.defer=true;
    s.dataset.api='https://YOUR-FUNCTION-ID.website.yandexcloud.net/api/chat';
    s.dataset.prompt='https://storage.yandexcloud.net/YOUR-BUCKET/Промпт.json';
    s.dataset.gas='https://script.google.com/macros/s/YOUR-GAS-URL/exec';
    document.head.appendChild(s);
  })();
</script>
```

Замените:
- `YOUR-BUCKET` - имя вашего bucket в Object Storage
- `YOUR-FUNCTION-ID` - ID функции в Yandex Cloud Functions
- `YOUR-GAS-URL` - URL вашего Google Apps Script

## Отличия от Vercel версии

1. **Redis**: Используется Yandex Managed Service for Redis вместо Upstash
2. **Деплой**: Yandex Cloud Functions вместо Vercel Serverless Functions
3. **Статика**: Yandex Object Storage вместо Vercel
4. **Изоляция**: Полностью независимая версия, изменения не влияют на Vercel версию

## Поддержка

Для вопросов и проблем обращайтесь к основной документации проекта.

