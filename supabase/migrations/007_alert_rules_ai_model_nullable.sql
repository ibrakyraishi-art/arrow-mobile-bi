-- 007: ai_model больше не заполняется (AI-генерация удалена в PR #51).
-- Колонка осталась NOT NULL DEFAULT 'haiku' с момента создания — из-за этого
-- вставка правила без AI-полей (ai_model = null) падала с
-- «null value in column "ai_model" violates not-null constraint».
-- Снимаем NOT NULL и default. Идемпотентно.

ALTER TABLE public.alert_rules ALTER COLUMN ai_model DROP NOT NULL;
ALTER TABLE public.alert_rules ALTER COLUMN ai_model DROP DEFAULT;

-- Обновляем schema cache PostgREST.
NOTIFY pgrst, 'reload schema';
