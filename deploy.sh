#!/bin/bash

# Скрипт для быстрого развертывания виджета на GitHub
# Использование: ./deploy.sh "Описание изменений"

echo "🚀 Начинаем развертывание виджета..."

# Проверяем, что мы в правильной директории
if [ ! -f "widget.js" ]; then
    echo "❌ Ошибка: Запустите скрипт из корневой папки проекта"
    exit 1
fi

# Проверяем наличие Git
if ! command -v git &> /dev/null; then
    echo "❌ Git не установлен. Установите Git и повторите попытку."
    exit 1
fi

# Получаем описание изменений
COMMIT_MSG=${1:-"Update widget configuration"}

echo "📝 Описание изменений: $COMMIT_MSG"

# Добавляем все файлы
echo "📁 Добавляем файлы..."
git add .

# Проверяем статус
echo "📊 Статус Git:"
git status --short

# Делаем коммит
echo "💾 Создаем коммит..."
git commit -m "$COMMIT_MSG"

# Отправляем на GitHub
echo "🚀 Отправляем на GitHub..."
git push origin main

echo "✅ Развертывание завершено!"
echo ""
echo "🔗 Проверьте развертывание:"
echo "1. GitHub Actions: https://github.com/$(git config user.name)/$(basename $(git remote get-url origin) .git)/actions"
echo "2. GitHub Pages: https://github.com/$(git config user.name)/$(basename $(git remote get-url origin) .git)/settings/pages"
echo ""
echo "📋 Не забудьте:"
echo "- Настроить OPENAI_API_KEY в GitHub Secrets"
echo "- Настроить Google Apps Script"
echo "- Обновить URL в коде интеграции"
