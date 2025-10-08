# 🚀 Подробная инструкция по развертыванию на GitHub

## Шаг 1: Подготовка проекта

### 1.1 Инициализация Git репозитория

```bash
# Перейдите в папку проекта
cd /Users/kmachuk/Desktop/Demo\ боты/Widget

# Инициализируйте Git (если еще не сделано)
git init

# Добавьте все файлы
git add .

# Сделайте первый коммит
git commit -m "Initial commit: Widget bot for sofa consultation"
```

### 1.2 Создание репозитория на GitHub

1. Зайдите на [github.com](https://github.com)
2. Нажмите "New repository"
3. Заполните:
   - **Repository name**: `widget-sofa-consultant` (или любое другое название)
   - **Description**: `Интерактивный виджет-бот для консультации по диванам`
   - **Visibility**: Public (для GitHub Pages) или Private
   - **НЕ** добавляйте README, .gitignore или лицензию (они уже есть)

4. Скопируйте URL репозитория (например: `https://github.com/ваш-username/widget-sofa-consultant.git`)

### 1.3 Подключение к GitHub

```bash
# Добавьте удаленный репозиторий
git remote add origin https://github.com/ваш-username/ваш-репозиторий.git

# Переименуйте основную ветку в main
git branch -M main

# Отправьте код на GitHub
git push -u origin main
```

## Шаг 2: Настройка GitHub Pages

### 2.1 Включение GitHub Pages

1. Зайдите в ваш репозиторий на GitHub
2. Перейдите в **Settings** → **Pages**
3. В разделе "Source" выберите **"GitHub Actions"**
4. Сохраните настройки

### 2.2 Настройка переменных окружения

1. Перейдите в **Settings** → **Secrets and variables** → **Actions**
2. Нажмите **"New repository secret"**
3. Добавьте:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: ваш ключ OpenAI API

## Шаг 3: Настройка Google Apps Script

### 3.1 Создание скрипта

1. Зайдите на [script.google.com](https://script.google.com)
2. Нажмите **"New project"**
3. Замените код на следующий:

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

### 3.2 Настройка Google Sheets

1. Создайте новую Google Таблицу
2. Переименуйте лист в **"Лист1"**
3. Добавьте заголовки в первую строку:
   - A1: **Имя**
   - B1: **Телефон**
   - C1: **Предложение**
   - D1: **URL страницы**
   - E1: **Session ID**
   - F1: **Время**

### 3.3 Развертывание Google Apps Script

1. В Google Apps Script нажмите **"Deploy"** → **"New deployment"**
2. Выберите тип: **"Web app"**
3. Настройки:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Нажмите **"Deploy"**
5. **Скопируйте URL** веб-приложения

## Шаг 4: Обновление конфигурации

### 4.1 Обновление URL в коде

Замените URL Google Apps Script в файлах:

**В `widget.js` (строка 12):**
```javascript
gasEndpoint: 'https://script.google.com/macros/s/ВАШ-НОВЫЙ-URL/exec',
```

**В `index.html` (строка 17):**
```html
s.dataset.gas='https://script.google.com/macros/s/ВАШ-НОВЫЙ-URL/exec';
```

### 4.2 Обновление package.json

Замените в `package.json`:
```json
"homepage": "https://ваш-username.github.io/ваш-репозиторий"
```

## Шаг 5: Развертывание

### 5.1 Автоматическое развертывание

После настройки GitHub Actions, код будет автоматически развертываться при каждом push в main ветку:

```bash
# Внесите изменения
git add .
git commit -m "Update configuration"
git push origin main
```

### 5.2 Проверка развертывания

1. Зайдите в **Actions** вкладку вашего репозитория
2. Убедитесь, что workflow выполнился успешно
3. Перейдите в **Settings** → **Pages** и проверьте URL

## Шаг 6: Интеграция на ваш сайт

### 6.1 Код для интеграции

Добавьте этот код в `<head>` вашего сайта:

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://ваш-username.github.io/ваш-репозиторий/widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='https://ваш-username.github.io/ваш-репозиторий/Промпт.json';
    s.dataset.catalog='https://ваш-username.github.io/ваш-репозиторий/Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/ВАШ-GAS-URL/exec';
    document.head.appendChild(s);
  })();
</script>
```

### 6.2 Тестирование

1. Откройте ваш сайт
2. Просмотрите 2+ страницы
3. Дождитесь появления виджета
4. Протестируйте чат-бота
5. Проверьте сохранение лидов в Google Sheets

## Шаг 7: Настройка и кастомизация

### 7.1 Настройка бота

Отредактируйте `Промпт.json`:
- Измените информацию о компании
- Настройте акции и предложения
- Измените стиль общения

### 7.2 Настройка каталога

Отредактируйте `Каталог.json`:
- Добавьте ваши товары
- Обновите цены и характеристики
- Добавьте изображения

### 7.3 Настройка внешнего вида

В `widget.js` (строка 17):
```javascript
brand: { accent: '#6C5CE7', bg: '#ffffff', text: '#111', radius: 16 }
```

## Шаг 8: Мониторинг и обновления

### 8.1 Мониторинг лидов

- Регулярно проверяйте Google Sheets
- Настройте уведомления на email
- Анализируйте эффективность

### 8.2 Обновления

При изменении файлов:
1. Обновите версию в `widget.js` (строка 3)
2. Замените версию в коде интеграции
3. Зафиксируйте изменения:

```bash
git add .
git commit -m "Update to version 5.0.1"
git push origin main
```

## 🐛 Устранение неполадок

### Виджет не появляется:
- Проверьте консоль браузера (F12)
- Убедитесь, что все URL доступны
- Проверьте настройки GitHub Pages

### Ошибки API:
- Проверьте переменную `OPENAI_API_KEY` в GitHub Secrets
- Убедитесь, что у вас есть кредиты на OpenAI

### Лиды не сохраняются:
- Проверьте URL Google Apps Script
- Убедитесь, что Google Sheets имеет лист "Лист1"
- Проверьте права доступа к Google Apps Script

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи в GitHub Actions
2. Убедитесь в правильности всех URL
3. Проверьте настройки Google Apps Script и Sheets
4. Обратитесь к документации в README.md

---

**Готово!** Ваш виджет-бот теперь развернут на GitHub и готов к использованию! 🎉
