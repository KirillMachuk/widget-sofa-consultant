# Виджет-бот для консультации по диванам

Интерактивный виджет-бот для сайта, который помогает клиентам выбрать диван и собирает лиды в Google Sheets.

## 🚀 Возможности

- **Умный чат-бот** с использованием OpenAI GPT
- **Каталог товаров** с актуальными ценами и характеристиками
- **Сбор лидов** с автоматической отправкой в Google Sheets
- **Адаптивный дизайн** для мобильных и десктопных устройств
- **Настраиваемые промпты** и каталог товаров
- **Интеграция с Google Apps Script** для обработки лидов

## 📋 Требования

- Node.js 22.x или выше
- OpenAI API ключ
- Google Apps Script для обработки лидов
- Google Sheets для хранения данных

## 🛠 Установка и развертывание

### Вариант 1: Развертывание на Vercel (Рекомендуется)

1. **Создайте репозиторий на GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/ваш-username/ваш-репозиторий.git
   git push -u origin main
   ```

2. **Подключите к Vercel:**
   - Зайдите на [vercel.com](https://vercel.com)
   - Нажмите "New Project"
   - Импортируйте ваш GitHub репозиторий
   - Настройте переменные окружения:
     - `OPENAI_API_KEY` - ваш ключ OpenAI

3. **Получите URL развертывания** и используйте его для интеграции

### Вариант 2: Развертывание на GitHub Pages

1. **Настройте GitHub Pages:**
   - Перейдите в Settings → Pages
   - Выберите "GitHub Actions" как источник
   - Создайте workflow файл (см. `.github/workflows/deploy.yml`)

2. **Настройте переменные окружения:**
   - Перейдите в Settings → Secrets and variables → Actions
   - Добавьте `OPENAI_API_KEY`

### Вариант 3: Локальное развертывание

1. **Клонируйте репозиторий:**
   ```bash
   git clone https://github.com/ваш-username/ваш-репозиторий.git
   cd ваш-репозиторий
   ```

2. **Установите зависимости:**
   ```bash
   npm install
   ```

3. **Настройте переменные окружения:**
   ```bash
   echo "OPENAI_API_KEY=ваш-ключ-openai" > .env.local
   ```

4. **Запустите локально:**
   ```bash
   npm start
   ```

## 🔧 Интеграция на сайт

### Для Vercel/GitHub Pages:

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://ваш-домен.vercel.app/widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='https://ваш-домен.vercel.app/Промпт.json';
    s.dataset.catalog='https://ваш-домен.vercel.app/Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/ВАШ-GAS-URL/exec';
    document.head.appendChild(s);
  })();
</script>
```

### Для локального сервера:

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='./widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='./Промпт.json';
    s.dataset.catalog='./Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/ВАШ-GAS-URL/exec';
    document.head.appendChild(s);
  })();
</script>
```

## ⚙️ Настройка

### 1. Настройка Google Apps Script

1. Создайте новый проект в [Google Apps Script](https://script.google.com)
2. Замените код на следующий:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Лист1');
    
    // Добавляем заголовки если их нет
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 6).setValues([['Имя', 'Телефон', 'Предложение', 'URL страницы', 'Session ID', 'Время']]);
    }
    
    // Добавляем данные
    sheet.appendRow([
      data.name || '',
      data.phone || '',
      data.pretext || '',
      data.page_url || '',
      data.session_id || '',
      new Date(data.timestamp || Date.now())
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({success: true}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. Разверните как веб-приложение с доступом "Все пользователи"
4. Скопируйте URL и замените в коде интеграции

### 2. Настройка Google Sheets

Создайте таблицу с колонками:
- **Имя** (A)
- **Телефон** (B) 
- **Предложение** (C)
- **URL страницы** (D)
- **Session ID** (E)
- **Время** (F)

### 3. Настройка виджета

Отредактируйте файлы:
- `Промпт.json` - настройки бота и компании
- `Каталог.json` - каталог товаров
- `widget.js` (строка 17) - цвета и стиль виджета

## 📁 Структура проекта

```
├── api/
│   ├── chat.js          # API для чата с OpenAI
│   └── lead.js          # API для отправки лидов
├── images/
│   └── consultant.jpg   # Изображение консультанта
├── .github/
│   └── workflows/
│       └── deploy.yml   # GitHub Actions для развертывания
├── index.html           # Тестовая страница
├── widget.js           # Основной код виджета
├── Промпт.json         # Настройки бота
├── Каталог.json        # Каталог товаров
├── package.json        # Зависимости проекта
├── vercel.json         # Конфигурация Vercel
└── README.md           # Документация
```

## 🔄 Обновление

При изменении файлов:
1. Обновите версию в `widget.js` (строка 3)
2. Замените `v=5.0.0` в коде интеграции на новую версию
3. Зафиксируйте изменения в Git

## 🐛 Устранение неполадок

### Виджет не появляется:
- Проверьте консоль браузера на ошибки
- Убедитесь, что все URL файлов доступны
- Проверьте настройки CORS

### Лиды не сохраняются:
- Проверьте URL Google Apps Script
- Убедитесь, что Google Sheets имеет лист "Лист1"
- Проверьте права доступа к Google Apps Script

### Ошибки API:
- Проверьте переменную окружения `OPENAI_API_KEY`
- Убедитесь, что у вас есть кредиты на OpenAI

## 📞 Поддержка

При возникновении проблем:
1. Проверьте консоль браузера
2. Убедитесь в правильности всех URL
3. Проверьте настройки Google Apps Script и Sheets

## 📄 Лицензия

MIT License
