-- 006: чистка старых AI/Insight-шаблонов уведомлений.
-- Они построены на «мёртвых» переменных ({code}, {channel}, {GEO}, {matches_count})
-- от удалённого AI-генератора. Подход перешёл на {table} (Конструктор анализа).
-- Сид-механизма шаблонов нет — удаляем существующие данные по префиксу имени.
-- Идемпотентно: повторный прогон просто ничего не найдёт.
-- FK alert_rules.template_id = ON DELETE SET NULL, поэтому правила не ломаются.

DELETE FROM public.notification_templates
WHERE name LIKE '[AI]%' OR name LIKE '[Insight]%';
