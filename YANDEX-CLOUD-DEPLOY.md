# Инструкция по развертыванию на Yandex Cloud

Полная инструкция по настройке и развертыванию виджета на Yandex Cloud для обеспечения доступности в России.

## Содержание

1. [Подготовка инфраструктуры](#подготовка-инфраструктуры)
2. [Настройка Redis](#настройка-redis)
3. [Настройка Object Storage](#настройка-object-storage)
4. [Настройка Cloud Functions](#настройка-cloud-functions)
5. [Настройка GitHub Actions](#настройка-github-actions)
6. [Интеграция виджета](#интеграция-виджета)

## Подготовка инфраструктуры

### 1. Создание облака и папки в Yandex Cloud

1. Войдите в [консоль Yandex Cloud](https://console.cloud.yandex.ru/)
2. Создайте облако (если еще не создано)
3. Создайте папку для проекта
4. Запишите `Cloud ID` и `Folder ID` - они понадобятся для настройки

### 2. Создание сервисного аккаунта

1. Перейдите в раздел "Сервисные аккаунты"
2. Создайте новый сервисный аккаунт с именем `widget-deploy`
3. Назначьте роли:
   - `serverless.functions.admin` - для управления функциями
   - `storage.admin` - для управления Object Storage
   - `vpc.user` - для доступа к Redis (если требуется)
4. Создайте статический ключ доступа (JSON)
5. Сохраните содержимое ключа - оно понадобится для GitHub Secrets

## Настройка Redis

### Создание Managed Service for Redis

1. Перейдите в раздел "Managed Service for Redis"
2. Нажмите "Создать кластер"
3. Настройки:
   - **Имя**: `widget-redis`
   - **Версия**: Redis 7.0 или новее
   - **Класс хоста**: s2.micro (для начала)
   - **Диск**: SSD, 10 GB
   - **Сеть**: выберите вашу сеть
   - **Пароль**: создайте надежный пароль
4. Дождитесь создания кластера (5-10 минут)
5. После создания запишите:
   - **Хост** (FQDN): `c-xxxxx.rw.mdb.yandexcloud.net`
   - **Порт**: обычно `6380` (TLS) или `6379` (без TLS)
   - **Пароль**: тот, что вы создали

### Настройка доступа

1. В настройках кластера Redis найдите раздел "Доступ"
2. Добавьте правило для доступа из Cloud Functions:
   - Источник: `Cloud Functions`
   - Или настройте Security Groups для доступа из нужных сетей

## Настройка Object Storage

### Создание bucket

1. Перейдите в раздел "Object Storage"
2. Создайте новый bucket:
   - **Имя**: `widget-static-files` (или другое уникальное имя)
   - **Тип доступа**: Публичный (для статических файлов)
3. После создания bucket запишите его имя

### Настройка публичного доступа

1. В настройках bucket перейдите в "Права доступа"
2. Включите "Публичный доступ для чтения"
3. Это позволит загружать виджет напрямую из Object Storage

## Настройка Cloud Functions

### Создание функций через консоль (первый раз)

1. Перейдите в раздел "Cloud Functions"
2. Создайте 4 функции:
   - `widget-chat`
   - `widget-lead`
   - `widget-analytics`
   - `widget-health`

Для каждой функции:
- **Runtime**: Node.js 22
- **Entrypoint**: 
  - `api.chat.cloudHandler` для chat
  - `api.lead.cloudHandler` для lead
  - `api.analytics.cloudHandler` для analytics
  - `api.health.cloudHandler` для health
- **Memory**: 256MB для chat/lead, 128MB для analytics/health
- **Timeout**: 30s для chat, 15s для lead, 10s для analytics/health

### Настройка переменных окружения

Для каждой функции добавьте переменные окружения:

**Для chat и health:**
- `OPENAI_API_KEY` - ваш ключ OpenAI
- `REDIS_HOST` - хост Redis кластера
- `REDIS_PORT` - порт Redis (6380 для TLS или 6379)
- `REDIS_PASSWORD` - пароль Redis

**Для lead и analytics:**
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`

### Настройка HTTP-триггеров

1. Для каждой функции создайте HTTP-триггер:
   - **Путь**: `/api/chat`, `/api/lead`, `/api/analytics`, `/api/health`
   - **Метод**: POST для chat/lead/analytics, GET для health
   - **Неаутентифицированные вызовы**: Разрешить

2. После создания триггеров запишите публичные URL функций

## Настройка GitHub Actions

### Добавление Secrets в GitHub

1. Перейдите в ваш репозиторий на GitHub
2. Settings → Secrets and variables → Actions
3. Добавьте следующие secrets:

**Обязательные:**
- `YC_SERVICE_ACCOUNT_KEY` - полное содержимое JSON ключа сервисного аккаунта
- `YC_CLOUD_ID` - ID вашего облака
- `YC_FOLDER_ID` - ID папки
- `OBJECT_STORAGE_BUCKET` - имя bucket в Object Storage
- `OPENAI_API_KEY` - ключ OpenAI API
- `REDIS_HOST` - хост Redis (FQDN)
- `REDIS_PORT` - порт Redis (6380 или 6379)
- `REDIS_PASSWORD` - пароль Redis

### Проверка workflow

1. После добавления secrets workflow будет автоматически запускаться при push в `main`
2. Проверьте выполнение в разделе "Actions" репозитория
3. При успешном деплое функции будут обновлены

## Интеграция виджета

### Получение URL

После деплоя вам понадобятся:

1. **URL виджета** (из Object Storage):
   ```
   https://storage.yandexcloud.net/YOUR-BUCKET/widget-external.js
   ```

2. **URL API** (из Cloud Functions):
   ```
   https://YOUR-FUNCTION-ID.website.yandexcloud.net/api/chat
   ```
   Или настройте API Gateway для единого домена

3. **URL промпта** (из Object Storage):
   ```
   https://storage.yandexcloud.net/YOUR-BUCKET/Промпт.json
   ```

### Код интеграции

Добавьте на сайт клиента:

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
- `YOUR-BUCKET` - имя вашего bucket
- `YOUR-FUNCTION-ID` - ID функции (можно найти в консоли Yandex Cloud)
- `YOUR-GAS-URL` - URL вашего Google Apps Script

### Настройка API Gateway (опционально)

Для единого домена можно настроить API Gateway:

1. Создайте API Gateway в Yandex Cloud
2. Настройте маршруты:
   - `/api/chat` → функция `widget-chat`
   - `/api/lead` → функция `widget-lead`
   - `/api/analytics` → функция `widget-analytics`
   - `/api/health` → функция `widget-health`
3. Получите публичный домен API Gateway
4. Используйте этот домен в `data-api` атрибуте виджета

## Мониторинг и отладка

### Проверка работы

1. **Health check**: `GET https://YOUR-FUNCTION-ID.website.yandexcloud.net/api/health`
   - Должен вернуть статус `healthy` для всех сервисов

2. **Логи функций**: В консоли Yandex Cloud → Cloud Functions → Логи
   - Просматривайте логи выполнения функций

3. **Метрики**: В разделе "Мониторинг" каждой функции
   - Отслеживайте количество вызовов, ошибки, время выполнения

### Типичные проблемы

**Проблема**: Функция не может подключиться к Redis
- **Решение**: Проверьте Security Groups, убедитесь что функции имеют доступ к сети Redis

**Проблема**: Статические файлы не загружаются
- **Решение**: Проверьте права доступа к bucket, убедитесь что включен публичный доступ

**Проблема**: OpenAI API недоступен
- **Решение**: Это нормально для России, виджет использует fallback механизм (circuit breaker)

## Обновление

### Обновление кода

1. Внесите изменения в файлы в папке `yandex-cloud/`
2. Сделайте commit и push в `main`
3. GitHub Actions автоматически задеплоит изменения

### Обновление переменных окружения

1. В консоли Yandex Cloud → Cloud Functions
2. Выберите функцию → Версии → Создать версию
3. Обновите переменные окружения
4. Новая версия будет использоваться автоматически

## Стоимость

Примерная стоимость (на 2024 год):
- **Cloud Functions**: ~500₽/мес за базовое использование
- **Managed Redis**: ~1000₽/мес за минимальный кластер
- **Object Storage**: ~50₽/мес за небольшой объем
- **Итого**: ~1500-2000₽/мес

## Поддержка

При возникновении проблем:
1. Проверьте логи функций в консоли Yandex Cloud
2. Проверьте статус сервисов через `/api/health`
3. Убедитесь что все переменные окружения настроены правильно

