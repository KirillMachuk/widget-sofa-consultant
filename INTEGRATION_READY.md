# 🚀 Виджет готов к интеграции!

## ✅ Статус проекта

- **Репозиторий**: https://github.com/KirillMachuk/widget-sofa-consultant
- **Google Apps Script**: ✅ Уже настроен и работает
- **GitHub Pages**: ⏳ Нужно настроить вручную

## 🔧 Быстрая интеграция

### Вариант 1: Через GitHub Pages (после настройки)

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://kirillmachuk.github.io/widget-sofa-consultant/widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='https://kirillmachuk.github.io/widget-sofa-consultant/Промпт.json';
    s.dataset.catalog='https://kirillmachuk.github.io/widget-sofa-consultant/Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/AKfycbyJg7_2DnyoROYCl_TrH4G7jzHTUD8MJnVy7Suf62o4m7zOA9nzPqKSP_pmUKXFaV3T7w/exec';
    document.head.appendChild(s);
  })();
</script>
```

### Вариант 2: Через Vercel (если развернут)

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='https://ваш-проект.vercel.app/widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='https://ваш-проект.vercel.app/Промпт.json';
    s.dataset.catalog='https://ваш-проект.vercel.app/Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/AKfycbyJg7_2DnyoROYCl_TrH4G7jzHTUD8MJnVy7Suf62o4m7zOA9nzPqKSP_pmUKXFaV3T7w/exec';
    document.head.appendChild(s);
  })();
</script>
```

### Вариант 3: Локальное размещение

Скопируйте файлы на ваш сервер:
- `widget.js`
- `Промпт.json`
- `Каталог.json`
- Папку `api/` (если нужен API)

```html
<script>
  (function(){
    var s=document.createElement('script');
    s.src='./widget.js?v=5.0.0';
    s.defer=true;
    s.dataset.prompt='./Промпт.json';
    s.dataset.catalog='./Каталог.json';
    s.dataset.gas='https://script.google.com/macros/s/AKfycbyJg7_2DnyoROYCl_TrH4G7jzHTUD8MJnVy7Suf62o4m7zOA9nzPqKSP_pmUKXFaV3T7w/exec';
    document.head.appendChild(s);
  })();
</script>
```

## ⚙️ Настройка GitHub Pages

1. Зайдите на https://github.com/KirillMachuk/widget-sofa-consultant/settings/pages
2. В разделе "Source" выберите **"GitHub Actions"**
3. Сохраните настройки
4. Дождитесь завершения развертывания

## 📊 Проверка работы

1. **Откройте ваш сайт**
2. **Просмотрите 2+ страницы** (виджет появляется после 2 страниц)
3. **Дождитесь появления виджета** (обычно через 1-2 минуты)
4. **Протестируйте чат-бота**
5. **Проверьте сохранение лидов** в Google Sheets

## 🔍 Устранение неполадок

### Виджет не появляется:
- Проверьте консоль браузера (F12)
- Убедитесь, что все URL доступны
- Проверьте, что просмотрено 2+ страницы

### Ошибки API:
- Проверьте переменную `OPENAI_API_KEY` в GitHub Secrets
- Убедитесь, что у вас есть кредиты на OpenAI

### Лиды не сохраняются:
- Google Apps Script уже настроен и работает
- Проверьте Google Sheets - должен быть лист "Лист1"
- Проверьте права доступа к Google Apps Script

## 🎯 Готово!

Ваш виджет готов к использованию! Google Apps Script уже настроен и будет автоматически сохранять лиды в Google Sheets.

**URL для интеграции**: Используйте любой из вариантов выше в зависимости от вашего способа развертывания.
