-- Ключи бесплатно-тирных LLM-провайдеров: Groq, Cerebras, Mistral. BYOK,
-- хранятся зашифрованными (как остальные *_api_key). Идемпотентно. RLS на
-- user_settings уже есть (auth.uid() = user_id) — новые столбцы её наследуют.

alter table public.user_settings
  add column if not exists groq_api_key text,
  add column if not exists cerebras_api_key text,
  add column if not exists mistral_api_key text;
