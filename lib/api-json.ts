/**
 * Читает JSON-ответ нашего API. Если сервер вернул не JSON (503/504 от
 * Vercel — HTML-страница), вместо «Unexpected token '<'» отдаём понятную
 * ошибку в поле `error`, как у обычных ответов `/api/*`.
 */
export async function readApiJson<T extends { error?: string }>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const busy = res.status === 503 || res.status === 504 || res.status === 502;
    return {
      error: busy
        ? `Сервер временно не ответил (${res.status}). Подождите пару секунд и нажмите «Обновить».`
        : `Неожиданный ответ сервера (${res.status}).`,
    } as T;
  }
}
