import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encryption";
import { emptyAnonState, parseAnonState, type AnonState } from "@/lib/anonymize";

/**
 * Хранилище словаря токенизации. Словарь (реальное значение ↔ код) хранится
 * ЗАШИФРОВАННЫМ в таблице `ai_anonymization_maps` (1 строка на проект), под RLS
 * (`auth.uid() = user_id`). Доступ только через серверный user-scoped клиент.
 */

/** Загружает и расшифровывает словарь проекта. При любой проблеме — пустой. */
export async function loadAnonState(
  supabase: SupabaseClient,
  projectId: string,
): Promise<AnonState> {
  try {
    const { data } = await supabase
      .from("ai_anonymization_maps")
      .select("map_encrypted")
      .eq("project_id", projectId)
      .maybeSingle();
    const enc = (data as { map_encrypted: string | null } | null)?.map_encrypted;
    if (!enc) return emptyAnonState();
    return parseAnonState(decrypt(enc));
  } catch {
    // Безопасный фоллбэк: пустой словарь. Утечки это не вызывает — маскировка
    // и обратная замена в рамках одного запроса остаются согласованными.
    return emptyAnonState();
  }
}

/** Шифрует и сохраняет словарь проекта (upsert по project_id). */
export async function saveAnonState(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  state: AnonState,
): Promise<void> {
  try {
    const mapEncrypted = encrypt(JSON.stringify(state));
    await supabase
      .from("ai_anonymization_maps")
      .upsert(
        { project_id: projectId, user_id: userId, map_encrypted: mapEncrypted },
        { onConflict: "project_id" },
      );
  } catch (e) {
    // Не блокируем анализ: коды восстановятся/пересоздадутся при следующем
    // запуске. Детали — только в серверный лог.
    console.error(
      "[anonymize-store] не удалось сохранить словарь токенизации:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
