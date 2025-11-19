#!/bin/bash

# Скрипт для ручного деплоя виджета в Yandex Cloud
# Использование: ./deploy-yandex.sh

set -e

echo "🚀 Начинаем деплой виджета в Yandex Cloud..."

# Проверяем наличие Yandex Cloud CLI
if ! command -v yc &> /dev/null; then
    echo "❌ Yandex Cloud CLI не установлен"
    echo "Установите: curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash"
    exit 1
fi

# Проверяем переменные окружения
if [ -z "$YC_CLOUD_ID" ] || [ -z "$YC_FOLDER_ID" ]; then
    echo "❌ Не установлены переменные окружения YC_CLOUD_ID и YC_FOLDER_ID"
    echo "Установите их или экспортируйте перед запуском скрипта"
    exit 1
fi

# Настройка Yandex Cloud CLI
yc config set cloud-id $YC_CLOUD_ID
yc config set folder-id $YC_FOLDER_ID

echo "📦 Деплой Cloud Functions..."

# Деплой функции chat
echo "Деплой функции chat..."
yc serverless function version create \
  --function-name=widget-chat \
  --runtime nodejs22 \
  --entrypoint api/chat.cloudHandler \
  --memory 256MB \
  --execution-timeout 30s \
  --source-path . \
  --environment OPENAI_API_KEY=$OPENAI_API_KEY,REDIS_HOST=$REDIS_HOST,REDIS_PORT=$REDIS_PORT,REDIS_PASSWORD=$REDIS_PASSWORD

# Деплой функции lead
echo "Деплой функции lead..."
yc serverless function version create \
  --function-name=widget-lead \
  --runtime nodejs22 \
  --entrypoint api/lead.cloudHandler \
  --memory 256MB \
  --execution-timeout 15s \
  --source-path . \
  --environment REDIS_HOST=$REDIS_HOST,REDIS_PORT=$REDIS_PORT,REDIS_PASSWORD=$REDIS_PASSWORD

# Деплой функции analytics
echo "Деплой функции analytics..."
yc serverless function version create \
  --function-name=widget-analytics \
  --runtime nodejs22 \
  --entrypoint api/analytics.cloudHandler \
  --memory 128MB \
  --execution-timeout 10s \
  --source-path . \
  --environment REDIS_HOST=$REDIS_HOST,REDIS_PORT=$REDIS_PORT,REDIS_PASSWORD=$REDIS_PASSWORD

# Деплой функции health
echo "Деплой функции health..."
yc serverless function version create \
  --function-name=widget-health \
  --runtime nodejs22 \
  --entrypoint api/health.cloudHandler \
  --memory 128MB \
  --execution-timeout 10s \
  --source-path . \
  --environment OPENAI_API_KEY=$OPENAI_API_KEY,REDIS_HOST=$REDIS_HOST,REDIS_PORT=$REDIS_PORT,REDIS_PASSWORD=$REDIS_PASSWORD

echo "📤 Загрузка статических файлов в Object Storage..."

# Загрузка файлов в Object Storage
if [ -n "$OBJECT_STORAGE_BUCKET" ]; then
    echo "Загрузка widget-external.js..."
    yc storage cp widget-external.js s3://$OBJECT_STORAGE_BUCKET/widget-external.js --public-read
    
    echo "Загрузка Промпт.json..."
    yc storage cp Промпт.json s3://$OBJECT_STORAGE_BUCKET/Промпт.json --public-read
    
    echo "Загрузка images/consultant.jpg..."
    yc storage cp images/consultant.jpg s3://$OBJECT_STORAGE_BUCKET/images/consultant.jpg --public-read
    
    echo "✅ Статические файлы загружены"
    echo "📝 Публичные URL:"
    echo "  - Widget: https://storage.yandexcloud.net/$OBJECT_STORAGE_BUCKET/widget-external.js"
    echo "  - Prompt: https://storage.yandexcloud.net/$OBJECT_STORAGE_BUCKET/Промпт.json"
    echo "  - Image: https://storage.yandexcloud.net/$OBJECT_STORAGE_BUCKET/images/consultant.jpg"
else
    echo "⚠️  OBJECT_STORAGE_BUCKET не установлен, пропускаем загрузку статики"
fi

echo "✅ Деплой завершен!"
echo ""
echo "📋 Следующие шаги:"
echo "1. Настройте API Gateway для маршрутизации запросов к функциям"
echo "2. Получите публичные URL функций"
echo "3. Обновите интеграцию виджета на сайтах клиентов"

