# 🚀 Статическая интеграция виджета (без API)

## ✅ Проблема решена!

Виджет теперь работает **без необходимости в API сервере**. Он использует локальную обработку сообщений и автоматически сохраняет лиды в Google Sheets.

## 🔧 Как интегрировать

### Вариант 1: Через GitHub Pages

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://kirillmachuk.github.io/widget-sofa-consultant/widget.js?v=5.0.1';
    s.defer=true;
    s.dataset.prompt='https://kirillmachuk.github.io/widget-sofa-consultant/Промпт.json';
    s.dataset.catalog='https://kirillmachuk.github.io/widget-sofa-consultant/Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/AKfycbyJg7_2DnyoROYCl_TrH4G7jzHTUD8MJnVy7Suf62o4m7zOA9nzPqKSP_pmUKXFaV3T7w/exec';
    document.head.appendChild(s);
  })();
</script>
```

### Вариант 2: Локальное размещение

1. **Скачайте файлы:**
   - `widget.js`
   - `Промпт.json`
   - `Каталог.json`

2. **Разместите на вашем сервере**

3. **Добавьте код:**
```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='./widget.js?v=5.0.1';
    s.defer=true;
    s.dataset.prompt='./Промпт.json';
    s.dataset.catalog='./Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/AKfycbyJg7_2DnyoROYCl_TrH4G7jzHTUD8MJnVy7Suf62o4m7zOA9nzPqKSP_pmUKXFaV3T7w/exec';
    document.head.appendChild(s);
  })();
</script>
```

## 🤖 Как работает бот

### Локальные ответы на ключевые слова:

- **"Привет"** → Приветствие и предложение помощи
- **"Диван"** → Список доступных диванов с ценами
- **"Цена"** → Информация о ценах и скидках
- **"Скидка"** → Специальные предложения
- **"Телефон"** → Предложение оставить контакты

### Автоматические функции:

- ✅ **Сбор лидов** - автоматически в Google Sheets
- ✅ **Форма обратной связи** - появляется при необходимости
- ✅ **Адаптивный дизайн** - работает на всех устройствах
- ✅ **Умные ответы** - на основе ключевых слов

## 📊 Что происходит:

1. **Пользователь заходит на сайт**
2. **Просматривает 2+ страницы**
3. **Появляется виджет** (через 1-2 минуты)
4. **Чат с ботом** - локальные умные ответы
5. **Сбор лидов** - автоматически в Google Sheets

## 🎯 Преимущества:

- ✅ **Не требует API сервера**
- ✅ **Работает на любом хостинге**
- ✅ **Быстрая загрузка**
- ✅ **Автоматическое сохранение лидов**
- ✅ **Умные ответы без ИИ**

## 🔧 Настройка Google Sheets

Google Apps Script уже настроен и работает! Убедитесь, что:

1. **В Google Sheets есть лист "Лист1"**
2. **Структура таблицы:**
   - A1: **Имя**
   - B1: **Телефон** 
   - C1: **Предложение**
   - D1: **URL страницы**
   - E1: **Session ID**
   - F1: **Время**

## 🚀 Готово!

Ваш виджет теперь работает **полностью автономно** без необходимости в API сервере!

**Обновите код на сайте** с новой версией `v=5.0.1` и виджет заработает с умными локальными ответами.
