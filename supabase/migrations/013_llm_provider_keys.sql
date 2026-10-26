-- Мультипровайдерность LLM: ключи OpenAI и Google (Gemini) для AI-анализа.
-- BYOK — каждый пользователь хранит свой ключ, зашифрованным (как anthropic_api_key).
-- Идемпотентно. RLS на user_settings уже есть (auth.uid() = user_id), новые
-- столбцы наследуют политику таблицы.

alter table public.user_settings
  add column if not exists openai_api_key text,
  add column if not exists google_api_key text;
