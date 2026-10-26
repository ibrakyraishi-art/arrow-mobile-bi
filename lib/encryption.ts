import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";

// Актуальный алгоритм — AES-256-GCM: аутентифицированное шифрование. Помимо
// конфиденциальности оно проверяет ЦЕЛОСТНОСТЬ — подменённый/повреждённый
// шифротекст не расшифруется (в отличие от CBC). Формат новых значений:
// `<iv-hex>:<authTag-hex>:<ciphertext-hex>` (3 части).
const GCM = "aes-256-gcm";
const GCM_IV_LENGTH = 12; // рекомендованный размер IV для GCM

// Legacy: раньше значения шифровались AES-256-CBC в формате
// `<iv-hex>:<ciphertext-hex>` (IV 16 байт). decrypt читает их по-прежнему,
// чтобы уже сохранённые пароли/ключи не сломались (миграция «на лету»:
// при следующем пересохранении значение перезапишется уже в GCM).
const CBC = "aes-256-cbc";
const CBC_IV_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "";
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY не задан. Сгенерируйте 32-байтовый ключ (64 hex) и положите в env.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("ENCRYPTION_KEY должен быть 64 hex символа (32 байта).");
  }
  return Buffer.from(raw, "hex");
}

const isHex = (s: string) => /^[0-9a-fA-F]+$/.test(s);

/**
 * Шифрует строку через AES-256-GCM.
 * Возвращает `<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 */
export function encrypt(text: string): string {
  if (text === "" || text === null || text === undefined) return "";
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv(GCM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Расшифровывает значение. Обратносовместимо по формату:
 *  - 3 части (`iv:authTag:ciphertext`) → AES-256-GCM (актуальный);
 *  - 2 части (`iv:ciphertext`)        → legacy AES-256-CBC.
 * Старый base64-фолбэк УДАЛЁН: base64 — это не шифрование (обратимый кодинг),
 * и его наличие ослабляло гарантию. В БД таких значений нет (проверено).
 * При неуспехе/неизвестном формате возвращает "" — вызывающий код это обрабатывает.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  const parts = encryptedText.split(":");

  // Актуальный формат: AES-256-GCM.
  if (
    parts.length === 3 &&
    parts.every(isHex) &&
    parts[0].length === GCM_IV_LENGTH * 2
  ) {
    try {
      const iv = Buffer.from(parts[0], "hex");
      const authTag = Buffer.from(parts[1], "hex");
      const ciphertext = Buffer.from(parts[2], "hex");
      const decipher = createDecipheriv(GCM, getKey(), iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // повреждённый/подменённый шифротекст или другой ключ → пусто
      return "";
    }
  }

  // Legacy: AES-256-CBC (старый формат, по-прежнему расшифровываем).
  if (
    parts.length === 2 &&
    isHex(parts[0]) &&
    isHex(parts[1]) &&
    parts[0].length === CBC_IV_LENGTH * 2
  ) {
    try {
      const iv = Buffer.from(parts[0], "hex");
      const ciphertext = Buffer.from(parts[1], "hex");
      const decipher = createDecipheriv(CBC, getKey(), iv);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return "";
    }
  }

  // Неизвестный/повреждённый формат — пусто (без небезопасного base64-фолбэка).
  return "";
}
