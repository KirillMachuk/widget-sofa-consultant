# ⚡ Быстрый старт: Развертывание на GitHub

## 🎯 Что мы сделаем

Развернем ваш виджет-бот на GitHub с автоматическим развертыванием на GitHub Pages.

## 📋 Предварительные требования

- ✅ GitHub аккаунт
- ✅ OpenAI API ключ
- ✅ Google аккаунт (для Google Sheets)

## 🚀 Пошаговая инструкция

### Шаг 1: Создание репозитория на GitHub

1. Зайдите на [github.com](https://github.com)
2. Нажмите **"New repository"**
3. Заполните:
   - **Repository name**: `widget-sofa-consultant`
   - **Description**: `Интерактивный виджет-бот для консультации по диванам`
   - **Visibility**: Public
   - **НЕ** добавляйте README, .gitignore или лицензию
4. Нажмите **"Create repository"**

### Шаг 2: Загрузка кода на GitHub

Выполните команды в терминале:

```bash
# Перейдите в папку проекта
cd /Users/kmachuk/Desktop/Demo\ боты/Widget

# Инициализируйте Git (если еще не сделано)
git init

# Добавьте удаленный репозиторий (замените URL на ваш)
git remote add origin https://github.com/ваш-username/widget-sofa-consultant.git

# Добавьте все файлы
git add .

# Сделайте первый коммит
git commit -m "Initial commit: Widget bot for sofa consultation"

# Переименуйте ветку в main
git branch -M main

# Отправьте код на GitHub
git push -u origin main
```

### Шаг 3: Настройка GitHub Pages

1. Зайдите в ваш репозиторий на GitHub
2. Перейдите в **Settings** → **Pages**
3. В разделе "Source" выберите **"GitHub Actions"**
4. Сохраните настройки

### Шаг 4: Настройка переменных окружения

1. В репозитории перейдите в **Settings** → **Secrets and variables** → **Actions**
2. Нажмите **"New repository secret"**
3. Добавьте:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: ваш ключ OpenAI API
4. Нажмите **"Add secret"**

### Шаг 5: Настройка Google Apps Script

1. Зайдите на [script.google.com](https://script.google.com)
2. Нажмите **"New project"**
3. Замените код на:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Лист1');
    
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 6).setValues([['Имя', 'Телефон', 'Предложение', 'URL страницы', 'Session ID', 'Время']]);
    }
    
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

4. Нажмите **"Deploy"** → **"New deployment"**
5. Выберите тип: **"Web app"**
6. Настройки:
   - **Execute as**: Me
   - **Who has access**: Anyone
7. Нажмите **"Deploy"**
8. **Скопируйте URL** веб-приложения

### Шаг 6: Создание Google Sheets

1. Создайте новую Google Таблицу
2. Переименуйте лист в **"Лист1"**
3. Добавьте заголовки в первую строку:
   - A1: **Имя**
   - B1: **Телефон**
   - C1: **Предложение**
   - D1: **URL страницы**
   - E1: **Session ID**
   - F1: **Время**

### Шаг 7: Обновление конфигурации

Замените URL Google Apps Script в файлах:

**В `widget.js` (строка 12):**
```javascript
gasEndpoint: 'https://script.google.com/macros/s/ВАШ-НОВЫЙ-URL/exec',
```

**В `index.html` (строка 17):**
```html
s.dataset.gas='https://script.google.com/macros/s/ВАШ-НОВЫЙ-URL/exec';
```

### Шаг 8: Обновление package.json

Замените в `package.json`:
```json
"homepage": "https://ваш-username.github.io/widget-sofa-consultant"
```

### Шаг 9: Развертывание

```bash
# Внесите изменения
git add .
git commit -m "Update configuration with Google Apps Script URL"
git push origin main
```

### Шаг 10: Проверка развертывания

1. Зайдите в **Actions** вкладку вашего репозитория
2. Убедитесь, что workflow выполнился успешно
3. Перейдите в **Settings** → **Pages** и проверьте URL
4. Ваш виджет будет доступен по адресу: `https://ваш-username.github.io/widget-sofa-consultant`

## 🔧 Интеграция на ваш сайт

Добавьте этот код в `<head>` вашего сайта:

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://ваш-username.github.io/widget-sofa-consultant/widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='https://ваш-username.github.io/widget-sofa-consultant/Промпт.json';
    s.dataset.catalog='https://ваш-username.github.io/widget-sofa-consultant/Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/ВАШ-GAS-URL/exec';
    document.head.appendChild(s);
  })();
</script>
```

## ✅ Проверка работы

1. Откройте ваш сайт
2. Просмотрите 2+ страницы
3. Дождитесь появления виджета
4. Протестируйте чат-бота
5. Проверьте сохранение лидов в Google Sheets

## 🎉 Готово!

Ваш виджет-бот теперь развернут на GitHub и готов к использованию!

## 📞 Поддержка

При возникновении проблем:
- Проверьте логи в GitHub Actions
- Убедитесь в правильности всех URL
- Обратитесь к подробной документации в `DEPLOYMENT.md`
