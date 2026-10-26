"use client";

import {
  ChevronDown,
  Eye,
  Globe,
  KeyRound,
  Lightbulb,
  Lock,
  ShieldCheck,
  Trash2,
} from "lucide-react";

/**
 * Объяснение, как работает добавление источника данных и почему это безопасно.
 * Два уровня: «простыми словами» (для всех) + «технические детали» (точно, для
 * тех, кто хочет проверить). Свёрнуто по умолчанию (нативный <details>).
 */

interface SafetyPoint {
  icon: React.ReactNode;
  title: string;
  text: string;
}

const SAFETY_POINTS: SafetyPoint[] = [
  {
    icon: <Lock className="h-4 w-4" />,
    title: "Пароль зашифрован",
    text: "Мы используем шифрование AES-256 — тот же стандарт, что и у банков. Даже если кто-то заглянет в нашу базу, он увидит бессмысленный набор символов, а не ваш пароль.",
  },
  {
    icon: <KeyRound className="h-4 w-4" />,
    title: "Ключ — только на сервере",
    text: "«Ключ» для расшифровки хранится отдельно, на сервере, и никогда не передаётся в ваш браузер. Без него зашифрованный пароль бесполезен.",
  },
  {
    icon: <Eye className="h-4 w-4" />,
    title: "Видите только вы",
    text: "Система устроена так, что каждый видит только свои подключения. Другие пользователи не получат доступ к вашим — даже теоретически.",
  },
  {
    icon: <Globe className="h-4 w-4" />,
    title: "Защищённое соединение",
    text: "Переключатель «SSL (HTTPS)» шифрует данные «в пути» между вами, нами и вашей базой. Рекомендуем держать его включённым.",
  },
  {
    icon: <Trash2 className="h-4 w-4" />,
    title: "Удалили — значит удалили",
    text: "Когда вы удаляете источник, вместе с ним из нашей базы исчезают и сами данные, и всё, что на них построено: датасеты, графики, дашборды, алерты и AI-проекты. Ничего «забытого» не остаётся.",
  },
];

const STEPS: { title: string; text: string }[] = [
  {
    title: "Вводите данные",
    text: "Вы указываете адрес базы, логин и пароль — так же, как вводите логин на любом сайте. В коде программы ничего из этого не записано.",
  },
  {
    title: "Проверяем связь",
    text: "По кнопке «Проверить» мы на пару секунд пробуем подключиться к базе, чтобы убедиться, что всё введено правильно. Если что-то не так — сразу подскажем.",
  },
  {
    title: "Сохраняем безопасно",
    text: "По кнопке «Сохранить» пароль по защищённому каналу (тот самый «замочек» в адресной строке) уходит на сервер, моментально превращается в зашифрованный набор символов — и только в таком виде попадает в базу. В читаемом виде пароль нигде не лежит.",
  },
];

/** Точные технические факты — для тех, кто хочет проверить «как именно». */
const TECH: { label: string; text: string }[] = [
  {
    label: "Алгоритм",
    text: "Пароли (ClickHouse), API-ключи LLM и токены Telegram шифруются AES-256-GCM (модуль node:crypto) — это аутентифицированное шифрование: помимо конфиденциальности оно проверяет целостность, поэтому подменённый шифротекст не расшифруется. На каждую запись — случайный вектор инициализации (IV), так что два одинаковых пароля дают разный результат. В БД хранится только строка вида iv:authTag:ciphertext в hex, открытого текста там нет.",
  },
  {
    label: "Мастер-ключ",
    text: "Ключ шифрования (ENCRYPTION_KEY, 32 байта) задан только в серверном окружении (env): его нет ни в коде репозитория, ни в базе, ни в браузере. Без этого ключа шифротекст математически бесполезен.",
  },
  {
    label: "Расшифровка — только на сервере",
    text: "Пароль расшифровывается на бэкенде непосредственно перед подключением к вашей БД (а API-ключ — перед вызовом LLM) и тут же отбрасывается. Ни один ответ API не содержит пароль или ключ в открытом виде — на клиент они не возвращаются никогда.",
  },
  {
    label: "Изоляция по пользователям (RLS)",
    text: "В Postgres включён Row Level Security: каждая строка привязана к user_id, а политики пускают только при auth.uid() = user_id. Даже с действующим токеном чужие подключения недоступны на уровне самой базы, а не только в интерфейсе.",
  },
  {
    label: "Шифрование «в пути» (TLS)",
    text: "Весь трафик — браузер ↔ наш сервер ↔ ваша БД — идёт по TLS/HTTPS. Для ClickHouse рекомендуется держать переключатель SSL включённым, тогда и это «последнее звено» зашифровано.",
  },
  {
    label: "Минимум хранения",
    text: "Данные из ClickHouse мы не храним — запросы выполняются вживую, результаты не складируются в нашу базу. Хранится только конфиг подключения (с зашифрованным паролем) и схема датасета. Для AI берётся срез на лету и не сохраняется (остаётся лишь текстовый ответ).",
  },
  {
    label: "Google Sheets: живой режим (данные не храним)",
    text: "Google-таблицы работают только в живом режиме: данные у нас НЕ хранятся — при каждом запросе подтягиваются из таблицы по ссылке (без лимита строк, всегда свежие). В базе остаётся только схема столбцов и сама ссылка, причём ССЫЛКА ЗАШИФРОВАНА на сервере (AES-256-GCM, как пароль) — открытой ссылки в базе нет, прочитать её без серверного ключа нельзя. Если в таблице несколько вкладок (листов), при подключении выбираете нужную. Ранее созданные «снимки» и загруженные файлы CSV/Excel продолжают работать.",
  },
  {
    label: "Удаление подчистую",
    text: "При удалении источника каскадом удаляется ВСЁ связанное: сохранённые строки файла/таблицы (file_sources), датасеты, визуализации, виджеты дашбордов, alert-правила с историей запусков и AI-проекты с их запусками и картами маскировки. Это обеспечено внешними ключами ON DELETE CASCADE и триггером на уровне самой БД (не только в интерфейсе). Остаётся лишь обезличенная строка в журнале действий (audit_log) — факт «источник удалён», без значений ваших данных.",
  },
  {
    label: "Минимум данных в LLM",
    text: "В AI-анализе в модель уходит срез данных (при срезе больше 500 строк показывается предупреждение о возможных ошибках), а конфиденциальные поля можно замаскировать (👁 → 🔒): реальные значения токенизируются на сервере, в LLM уходят коды, а в ответе подставляются обратно.",
  },
];

export function SecurityNote() {
  return (
    <details className="group mb-6 rounded-xl border border-border bg-secondary/40">
      <summary className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3.5 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            Безопасно ли подключать сюда свою базу данных? Коротко — да.
          </span>
          <span className="block text-xs text-muted-foreground">
            Нажмите, чтобы прочитать простыми словами и технически: как это
            работает и что защищает ваши данные.
          </span>
        </span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-5 border-t border-border px-4 pb-5 pt-4">
        {/* Как это работает — по шагам */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Как происходит подключение
          </h3>
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {step.title}.
                  </span>{" "}
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Что защищает данные — простыми словами */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Что защищает ваши данные
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SAFETY_POINTS.map((point) => (
              <li key={point.title} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {point.icon}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {point.title}.
                  </span>{" "}
                  {point.text}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Технические детали — точно, для тех, кто хочет проверить */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Технические детали
          </h3>
          <ul className="space-y-2.5">
            {TECH.map((item) => (
              <li
                key={item.label}
                className="rounded-lg border border-border/60 bg-background/40 p-3"
              >
                <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-primary">
                  {item.label}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Практический совет */}
        <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <Lightbulb className="h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Совет.</span> Создайте
            для подключения отдельного пользователя базы с правами «только
            чтение» (read-only). Тогда платформа сможет строить отчёты, но при
            всём желании ничего не изменит и не удалит в вашей базе.
          </p>
        </div>
      </div>
    </details>
  );
}
