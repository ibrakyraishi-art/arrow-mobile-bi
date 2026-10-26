import type {
  CalculatedField,
  ColumnInfo,
  Dashboard,
  DashboardFilter,
  DashboardSheet,
  DashboardWidget,
  DashboardWidgetWidth,
  Dataset,
  DatasetColumn,
  DatasetColumnType,
  FunnelStep,
  MetricWidgetConfig,
  PivotValueConfig,
  QueryResultRow,
  TableInfo,
  Visualization,
  VisualizationConfig,
  VisualizationType,
} from "./types";
import { BRAND_NAME } from "./brand";
import { mapClickhouseType } from "./type-mapping";
import {
  DEMO_PLAN_CALIBRATION,
  DEMO_PLAN_DATASET_ID,
  DEMO_PLAN_MONTHLY,
  addMonths,
  buildDemoPlanProject,
  buildPlanDashboard,
  daysInMonth,
  monthOf,
  moscowDate,
  moscowMonth,
  planColumnName,
} from "./plan";

/**
 * Демо-данные мобильного маркетинга (таблица `installs_daily`).
 *
 * Детерминированный генератор: одинаковое «сейчас» → одинаковые строки.
 * Период — 3 полных месяца до текущего + текущий месяц по сегодня (по Москве),
 * одна строка = день × кампания (кампания задаёт клиента, канал, гео и баера).
 * Объём держим в пределах `FILE_MAX_ROWS` (lib/file-constants.ts — лимит
 * файлового загрузчика), чтобы CSV-выгрузка была тем же набором целиком.
 * При импорте модуля ничего не генерируется: строки и сиды строятся по вызову
 * от явного «сейчас».
 *
 * Все клиенты, баеры и кампании вымышлены.
 */

export const DEMO_SOURCE_ID = "demo-clickhouse";
export const DEMO_TABLE = "installs_daily";
/** Id демо-датасета (= `DEMO_PLAN_DATASET_ID` из lib/plan — на него ссылается демо-план). */
export const DEMO_DATASET_ID = DEMO_PLAN_DATASET_ID;
/** Курс для `spend_usd` / `revenue_usd` (константа демо). */
export const DEMO_USD_RUB = 92.5;
/** CSV-выгрузка демо-данных на сегодня (app/api/demo-csv); статичная копия — `npm run demo:csv`. */
export const DEMO_CSV_URL = "/api/demo-csv";
export const DEMO_CSV_FILENAME = "arrow-mobile-demo.csv";

/**
 * Один текст на все попытки сохранить своё на демо-датасете (график, дашборд
 * план/факт): в БД объекты ссылаются на датасет по uuid, демо-датасета там нет.
 */
export const DEMO_SAVE_HINT =
  "Демо-данные не сохраняются. Чтобы сохранить свой график или дашборд — загрузите CSV как источник.";
/** Куда ведёт ссылка из `DEMO_SAVE_HINT`: новый источник (тип «Файл (CSV / Excel)»). */
export const DEMO_SAVE_HINT_HREF = "/data-sources/new";

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

interface ClientDef {
  name: string;
  code: string;
  /** Относительный объём бюджета. */
  weight: number;
  /** Множитель CPI клиента. */
  cpi: number;
  /** Доля регистраций от установок. */
  reg: number;
  /** Доля покупок от установок. */
  buy: number;
  /** Средний чек, ₽. */
  check: number;
  /** Недельная сезонность, пн…вс. */
  week: number[];
  /** Каналы клиента (коды). */
  channels: string[];
  /** Рост за период (×). */
  growth: number;
}

const CLIENTS: ClientDef[] = [
  {
    name: "Сытно — доставка еды",
    code: "sytno",
    weight: 1.25,
    cpi: 1.0,
    reg: 0.46,
    buy: 0.11,
    check: 870,
    week: [0.9, 0.88, 0.92, 0.98, 1.18, 1.3, 1.12],
    channels: ["yd", "vk", "tt", "tg"],
    growth: 1.05,
  },
  {
    name: "Финвей Банк",
    code: "finway",
    weight: 1.0,
    cpi: 1.45,
    reg: 0.34,
    buy: 0.05,
    check: 2600,
    week: [1.12, 1.1, 1.08, 1.05, 1.0, 0.78, 0.74],
    channels: ["yd", "vk", "tg", "asa"],
    growth: 1.0,
  },
  {
    name: "Базарчик — маркетплейс",
    code: "bazar",
    weight: 0.9,
    cpi: 0.92,
    reg: 0.52,
    buy: 0.09,
    check: 1150,
    week: [0.98, 0.96, 0.97, 1.0, 1.05, 1.06, 1.0],
    channels: ["yd", "vk", "tt", "mt"],
    // Растущий клиент: к концу периода втрое больше, чем в начале.
    growth: 2.8,
  },
  {
    name: "Пиксельные войны — игра",
    code: "pixel",
    weight: 1.05,
    cpi: 0.74,
    reg: 0.62,
    buy: 0.04,
    check: 1500,
    week: [0.88, 0.86, 0.9, 0.95, 1.08, 1.25, 1.22],
    channels: ["tt", "vk", "asa", "mt"],
    growth: 1.0,
  },
  {
    name: "Едем! Такси",
    code: "edem",
    weight: 0.85,
    cpi: 0.96,
    reg: 0.5,
    buy: 0.14,
    check: 460,
    week: [1.0, 0.97, 0.98, 1.02, 1.2, 1.08, 0.9],
    channels: ["yd", "vk", "tg", "mt"],
    growth: 0.95,
  },
];

interface ChannelDef {
  name: string;
  code: string;
  /** Доля бюджета канала. */
  share: number;
  /** Множитель CPI канала. */
  cpi: number;
  /** Конверсия клик → установка. */
  cr: number;
  /** CTR показ → клик. */
  ctr: number;
}

const CHANNELS: ChannelDef[] = [
  { name: "Яндекс Директ", code: "yd", share: 1.3, cpi: 1.0, cr: 0.32, ctr: 0.012 },
  { name: "VK Реклама", code: "vk", share: 1.15, cpi: 0.86, cr: 0.27, ctr: 0.009 },
  { name: "Telegram Ads", code: "tg", share: 0.9, cpi: 1.25, cr: 0.22, ctr: 0.006 },
  { name: "TikTok", code: "tt", share: 1.1, cpi: 0.7, cr: 0.36, ctr: 0.021 },
  { name: "Apple Search Ads", code: "asa", share: 0.8, cpi: 1.6, cr: 0.55, ctr: 0.07 },
  { name: "MyTarget", code: "mt", share: 0.75, cpi: 0.8, cr: 0.24, ctr: 0.008 },
];

/** Канал с просадкой в середине периода. */
const DIP_CHANNEL = "vk";

const GEOS: { name: string; code: string; pick: number; volume: number }[] = [
  { name: "Москва", code: "msk", pick: 0.28, volume: 1.5 },
  { name: "Санкт-Петербург", code: "spb", pick: 0.2, volume: 1.2 },
  { name: "Екатеринбург", code: "ekb", pick: 0.13, volume: 0.85 },
  { name: "Новосибирск", code: "nsk", pick: 0.13, volume: 0.8 },
  { name: "Казань", code: "kzn", pick: 0.13, volume: 0.8 },
  { name: "Краснодар", code: "krd", pick: 0.13, volume: 0.85 },
];

const BUYERS = [
  "Алексей Корнеев",
  "Мария Соколова",
  "Дмитрий Панов",
  "Анна Ветрова",
  "Игорь Лесков",
];

/** Типы кампаний: окно активности (доли периода) и множитель покупок. */
const CAMPAIGN_KINDS: { name: string; code: string; from: number; to: number; buy: number; size: number }[] = [
  { name: "Установки", code: "install", from: 0, to: 1, buy: 1.0, size: 1.0 },
  { name: "Ретаргетинг", code: "retarget", from: 0, to: 0.55, buy: 1.8, size: 0.55 },
  { name: "Покупки", code: "purchase", from: 0.55, to: 1, buy: 1.4, size: 0.8 },
  { name: "Тест креативов", code: "test", from: 0.2, to: 0.4, buy: 0.8, size: 0.4 },
];

// ---------------------------------------------------------------------------
// Детерминированный случайный генератор
// ---------------------------------------------------------------------------

/** FNV-1a → 32-битный хеш строки. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: последовательность [0, 1) из сида. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Одно случайное число [0, 1), привязанное к ключу (стабильно для дня и кампании). */
function noise(key: string): number {
  return sequence(hash(key))();
}

// ---------------------------------------------------------------------------
// Кампании
// ---------------------------------------------------------------------------

interface CampaignDef {
  id: string;
  name: string;
  client: ClientDef;
  channel: ChannelDef;
  geo: (typeof GEOS)[number];
  buyer: string;
  kind: (typeof CAMPAIGN_KINDS)[number];
  /** Индивидуальный размер кампании. */
  size: number;
}

function buildCampaigns(): CampaignDef[] {
  const rnd = sequence(20260801);
  const pickGeo = () => {
    let x = rnd();
    for (const g of GEOS) {
      x -= g.pick;
      if (x < 0) return g;
    }
    return GEOS[0];
  };
  const channelByCode = new Map(CHANNELS.map((c) => [c.code, c]));
  const out: CampaignDef[] = [];
  let pair = 0;
  for (const client of CLIENTS) {
    for (const code of client.channels) {
      const channel = channelByCode.get(code)!;
      const buyer = BUYERS[pair % BUYERS.length];
      pair++;
      const count = 2 + Math.floor(rnd() * 3); // 2–4 кампании на клиент × канал
      for (let k = 0; k < count; k++) {
        const kind = CAMPAIGN_KINDS[k];
        const geo = k === 0 ? GEOS[Math.floor(rnd() * 2)] : pickGeo();
        out.push({
          id: `${client.code}_${channel.code}_${geo.code}_${kind.code}`,
          name: `${client.code}_${channel.code}_${geo.code}_${kind.code}`,
          client,
          channel,
          geo,
          buyer,
          kind,
          size: 0.7 + rnd() * 0.6,
        });
      }
    }
  }
  return out;
}

let campaignsCache: CampaignDef[] | null = null;

/** Кампании — лениво, при первой генерации (не при импорте модуля). */
function campaigns(): CampaignDef[] {
  if (!campaignsCache) campaignsCache = buildCampaigns();
  return campaignsCache;
}

// ---------------------------------------------------------------------------
// Генерация строк
// ---------------------------------------------------------------------------

/** Даты `YYYY-MM-DD` с from по to включительно (UTC-арифметика). */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** День недели 0 = пн … 6 = вс. */
function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** «Сырые» (дробные) метрики строки до калибровки. */
interface RawRow {
  date: string;
  campaign: CampaignDef;
  impressions: number;
  clicks: number;
  installs: number;
  registrations: number;
  purchases: number;
  spend: number;
  revenue: number;
}

function rawRows(dates: string[]): RawRow[] {
  const n = dates.length;
  const out: RawRow[] = [];
  dates.forEach((date, i) => {
    const t = n > 1 ? i / (n - 1) : 1;
    for (const c of campaigns()) {
      if (t < c.kind.from || t > c.kind.to) continue;
      const r = (salt: string) => noise(`${c.id}|${date}|${salt}`);
      const growth = 1 + (c.client.growth - 1) * t;
      // Просадка канала: колокол в середине периода (до −55% объёма, CPI +40%).
      const bump = c.channel.code === DIP_CHANNEL ? Math.exp(-(((t - 0.5) / 0.1) ** 2)) : 0;
      const volume =
        9000 *
        c.client.weight *
        c.channel.share *
        c.geo.volume *
        c.kind.size *
        c.size *
        c.client.week[weekday(date)] *
        growth *
        (1 - 0.55 * bump) *
        (0.85 + 0.3 * r("spend"));
      const cpi = 110 * c.client.cpi * c.channel.cpi * (1 + 0.4 * bump) * (0.9 + 0.2 * r("cpi"));
      const installs = volume / cpi;
      const clicks = installs / (c.channel.cr * (0.9 + 0.2 * r("cr")));
      const impressions = clicks / (c.channel.ctr * (0.85 + 0.3 * r("ctr")));
      const registrations = installs * c.client.reg * (0.9 + 0.2 * r("reg"));
      const purchases = installs * c.client.buy * c.kind.buy * (0.8 + 0.4 * r("buy"));
      const revenue = purchases * c.client.check * (0.85 + 0.3 * r("check"));
      out.push({
        date,
        campaign: c,
        impressions,
        clicks,
        installs,
        registrations,
        purchases,
        spend: volume,
        revenue,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Калибровка под демо-план (lib/plan/demo-project.ts)
// ---------------------------------------------------------------------------

type Ratios = { spend: number; installs: number; purchases: number; roas: number };

/**
 * Факт ÷ план (на дату) по прошлым месяцам — около плана, в пределах
 * `DEMO_PLAN_CALIBRATION.pastMonths`. Текущий месяц — `DEMO_PLAN_CALIBRATION.currentMonth`.
 */
const PAST_RATIOS: Record<number, Ratios> = {
  [-3]: { spend: 0.97, installs: 1.01, purchases: 0.96, roas: 1.02 },
  [-2]: { spend: 0.99, installs: 0.97, purchases: 1.0, roas: 0.98 },
  [-1]: { spend: 1.01, installs: 0.99, purchases: 0.98, roas: 1.0 },
};

function ratiosFor(offset: number): Ratios {
  if (offset === 0) return DEMO_PLAN_CALIBRATION.currentMonth;
  const { min, max } = DEMO_PLAN_CALIBRATION.pastMonths;
  const r = PAST_RATIOS[offset] ?? { spend: 1, installs: 1, purchases: 1, roas: 1 };
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return { spend: clamp(r.spend), installs: clamp(r.installs), purchases: clamp(r.purchases), roas: clamp(r.roas) };
}

/**
 * Масштабирует сырые строки помесячно так, чтобы итоги месяца попали в цель:
 * факт = план на дату × доля калибровки (план на дату = план × дней с данными ÷ дней в месяце).
 * Форма внутри месяца (сезонность, тренды, доли клиентов и каналов) сохраняется.
 * Клики и показы идут за установками — CTR и CR в установку остаются правдоподобными.
 */
function calibrate(raw: RawRow[], currentMonth: string): void {
  const byMonth = new Map<string, RawRow[]>();
  for (const r of raw) {
    const m = monthOf(r.date);
    const list = byMonth.get(m) ?? [];
    list.push(r);
    byMonth.set(m, list);
  }
  for (const [month, rows] of Array.from(byMonth.entries())) {
    let offset = 0;
    while (offset > -12 && addMonths(currentMonth, offset) !== month) offset--;
    const plan = DEMO_PLAN_MONTHLY[offset];
    if (!plan) continue;
    const ratio = ratiosFor(offset);
    const share = new Set(rows.map((r) => r.date)).size / daysInMonth(month);
    const sum = (k: keyof Pick<RawRow, "spend" | "installs" | "purchases" | "revenue">) =>
      rows.reduce((s, r) => s + r[k], 0);
    const spendTarget = plan.spend * share * ratio.spend;
    const fSpend = spendTarget / sum("spend");
    const fInstalls = (plan.installs * share * ratio.installs) / sum("installs");
    const fPurchases = (plan.purchases * share * ratio.purchases) / sum("purchases");
    const fRevenue = (spendTarget * (plan.roas / 100) * ratio.roas) / sum("revenue");
    for (const r of rows) {
      r.spend *= fSpend;
      r.installs *= fInstalls;
      r.clicks *= fInstalls;
      r.impressions *= fInstalls;
      r.registrations *= fInstalls;
      r.purchases *= fPurchases;
      r.revenue *= fRevenue;
    }
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Округление с переносом остатка: сумма целых по набору строк совпадает
 * с округлённой суммой дробных (итоги месяца не «уплывают» от округления).
 */
function carryRound(values: number[]): number[] {
  let acc = 0;
  let prev = 0;
  return values.map((v) => {
    acc += v;
    const cur = Math.round(acc);
    const out = cur - prev;
    prev = cur;
    return out;
  });
}

/**
 * Строки демо-таблицы `installs_daily` относительно «сейчас».
 * Период: 1-е число месяца три месяца назад … сегодня (по Москве).
 */
export function generateDemoRows(now: Date): QueryResultRow[] {
  const today = moscowDate(now);
  const start = `${addMonths(moscowMonth(now), -3)}-01`;
  const raw = rawRows(dateRange(start, today));
  calibrate(raw, moscowMonth(now));

  const ints = (key: "impressions" | "clicks" | "installs" | "registrations" | "purchases") =>
    carryRound(raw.map((r) => r[key]));
  const impressions = ints("impressions");
  const clicks = ints("clicks");
  const installs = ints("installs");
  const registrations = ints("registrations");
  const purchases = ints("purchases");

  return raw.map((r, i) => {
    const spendRub = round2(r.spend);
    const revenueRub = round2(r.revenue);
    return {
      date: r.date,
      client: r.campaign.client.name,
      channel: r.campaign.channel.name,
      geo: r.campaign.geo.name,
      buyer: r.campaign.buyer,
      campaign: r.campaign.name,
      impressions: impressions[i],
      clicks: clicks[i],
      installs: installs[i],
      registrations: registrations[i],
      purchases: purchases[i],
      spend_rub: spendRub,
      spend_usd: round2(spendRub / DEMO_USD_RUB),
      revenue_rub: revenueRub,
      revenue_usd: round2(revenueRub / DEMO_USD_RUB),
    };
  });
}

/** Порядок колонок `installs_daily` (он же — заголовки CSV). */
export const DEMO_COLUMN_NAMES = [
  "date",
  "client",
  "channel",
  "geo",
  "buyer",
  "campaign",
  "impressions",
  "clicks",
  "installs",
  "registrations",
  "purchases",
  "spend_rub",
  "spend_usd",
  "revenue_rub",
  "revenue_usd",
] as const;

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (UTF-8 с BOM, разделитель — запятая, заголовки = имена колонок). */
export function demoRowsToCsv(rows: QueryResultRow[]): string {
  const lines = [DEMO_COLUMN_NAMES.join(",")];
  for (const r of rows) lines.push(DEMO_COLUMN_NAMES.map((c) => csvCell(r[c])).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Доступ из движка (/api/query, preview, columns, алерты)
// ---------------------------------------------------------------------------

let cached: { day: string; data: Record<string, QueryResultRow[]> } | null = null;

/** Демо-таблицы по имени на день `now` (по Москве). Кешируется на последний запрошенный день. */
export function getDemoDataAt(now: Date): Record<string, QueryResultRow[]> {
  const day = moscowDate(now);
  if (cached && cached.day === day) return cached.data;
  cached = { day, data: { [DEMO_TABLE]: generateDemoRows(now) } };
  return cached.data;
}

/** Демо-таблицы по имени на сегодня (по Москве). */
export function getDemoData(): Record<string, QueryResultRow[]> {
  return getDemoDataAt(new Date());
}

export function getDemoPreview(table: string, limit = 100): QueryResultRow[] {
  const all = getDemoData()[table];
  if (!all) return [];
  return all.slice(0, limit);
}

export function isDemoSource(id: string): boolean {
  return id === DEMO_SOURCE_ID;
}

// ---------------------------------------------------------------------------
// Метаданные таблицы и демо-датасет
// ---------------------------------------------------------------------------

/** label — короткое описание колонки (подписи в шаблонах), context — развёрнуто для AI. */
const COLUMN_META: Record<(typeof DEMO_COLUMN_NAMES)[number], { type: string; label: string; context: string }> = {
  date: { type: "Date", label: "Дата", context: "День статистики" },
  client: { type: "LowCardinality(String)", label: "Клиент", context: "Клиент — мобильное приложение (вымышленное)" },
  channel: { type: "LowCardinality(String)", label: "Канал", context: "Рекламный канал (сеть)" },
  geo: { type: "LowCardinality(String)", label: "Гео", context: "Регион показа" },
  buyer: { type: "LowCardinality(String)", label: "Баер", context: "Баер, который ведёт кампанию" },
  campaign: { type: "String", label: "Кампания", context: "Кампания: клиент_канал_гео_цель" },
  impressions: { type: "UInt32", label: "Показы", context: "Показы рекламы" },
  clicks: { type: "UInt32", label: "Клики", context: "Клики по рекламе" },
  installs: { type: "UInt32", label: "Установки", context: "Установки приложения" },
  registrations: { type: "UInt32", label: "Регистрации", context: "Регистрации в приложении" },
  purchases: { type: "UInt32", label: "Покупки", context: "Покупки (целевые действия)" },
  spend_rub: { type: "Float64", label: "Расход ₽", context: "Расход, ₽" },
  spend_usd: { type: "Float64", label: "Расход $", context: `Расход, $ (по курсу ${DEMO_USD_RUB} ₽)` },
  revenue_rub: { type: "Float64", label: "Выручка ₽", context: "Выручка от покупок, ₽" },
  revenue_usd: { type: "Float64", label: "Выручка $", context: `Выручка, $ (по курсу ${DEMO_USD_RUB} ₽)` },
};

/** Колонки демо-таблиц (ClickHouse-типы — демо-источник притворяется ClickHouse). */
export const DEMO_COLUMNS: Record<string, ColumnInfo[]> = {
  [DEMO_TABLE]: DEMO_COLUMN_NAMES.map((name) => ({ name, type: COLUMN_META[name].type })),
};

export const DEMO_COLUMN_AI_DESCRIPTIONS: Record<string, Record<string, string>> = {
  [DEMO_TABLE]: Object.fromEntries(
    DEMO_COLUMN_NAMES.map((name) => [name, COLUMN_META[name].context]),
  ),
};

export const DEMO_CALCULATED_FIELDS: Record<string, CalculatedField[]> = {
  [DEMO_TABLE]: [
    {
      id: "demo-calc-cpi-rub",
      name: "CPI ₽",
      formula: "SUM([spend_rub]) / SUM([installs])",
      datasetType: "float",
      format: "currency_rub",
      description: "Стоимость установки: расход ÷ установки по группе",
      aiDescription: "SUM(spend_rub)/SUM(installs) по группе; меньше — лучше",
    },
    {
      id: "demo-calc-cpi-usd",
      name: "CPI $",
      formula: "SUM([spend_usd]) / SUM([installs])",
      datasetType: "float",
      format: "currency_usd",
      description: "Стоимость установки в долларах",
      aiDescription: "SUM(spend_usd)/SUM(installs) по группе",
    },
    {
      id: "demo-calc-cpa-rub",
      name: "CPA ₽",
      formula: "SUM([spend_rub]) / SUM([purchases])",
      datasetType: "float",
      format: "currency_rub",
      description: "Стоимость покупки: расход ÷ покупки по группе",
      aiDescription: "SUM(spend_rub)/SUM(purchases) по группе; меньше — лучше",
    },
    {
      id: "demo-calc-ctr",
      name: "CTR %",
      formula: "SUM([clicks]) / SUM([impressions]) * 100",
      datasetType: "float",
      format: "percent",
      description: "Кликабельность: клики ÷ показы × 100",
      aiDescription: "SUM(clicks)/SUM(impressions)×100 по группе; норма 0.5–2%",
    },
    {
      id: "demo-calc-cr-install",
      name: "CR в установку %",
      formula: "SUM([installs]) / SUM([clicks]) * 100",
      datasetType: "float",
      format: "percent",
      description: "Конверсия клика в установку: установки ÷ клики × 100",
      aiDescription: "SUM(installs)/SUM(clicks)×100 по группе",
    },
    {
      id: "demo-calc-roas",
      name: "ROAS %",
      formula: "SUM([revenue_rub]) / SUM([spend_rub]) * 100",
      datasetType: "float",
      format: "percent",
      description: "Окупаемость рекламы: выручка ÷ расход × 100",
      aiDescription: "SUM(revenue_rub)/SUM(spend_rub)×100 по группе; хорошо > 100%",
    },
  ],
};

export const DEMO_BUSINESS_CONTEXT =
  "Агентство мобильного маркетинга Arrow Mobile. Ведём 5 приложений-клиентов (доставка еды, банк, маркетплейс, игра, такси) " +
  "в каналах VK Реклама, Яндекс Директ, Telegram Ads, TikTok, Apple Search Ads и MyTarget по 6 регионам РФ. " +
  "Ключевые метрики: расход, установки, CPI, покупки, ROAS. План на месяц — в разделе «План».";

export const DEMO_FUNNEL_STEPS: FunnelStep[] = [
  { column: "impressions", label: "Показы", order: 0 },
  { column: "clicks", label: "Клики", order: 1 },
  { column: "installs", label: "Установки", order: 2 },
  { column: "registrations", label: "Регистрации", order: 3 },
  { column: "purchases", label: "Покупки", order: 4 },
];

/** Метаданные демо-таблиц на день `now`: число строк — из реально сгенерированных данных. */
export function getDemoTables(now: Date): TableInfo[] {
  return [{ name: DEMO_TABLE, engine: "MergeTree", totalRows: getDemoDataAt(now)[DEMO_TABLE].length }];
}

/** Число строк демо-таблиц на день `now`. */
export function getDemoRowCounts(now: Date): Record<string, number> {
  return Object.fromEntries(getDemoTables(now).map((t) => [t.name, t.totalRows ?? 0]));
}

/**
 * Совместимость со старыми потребителями (`/api/data-sources/[id]/tables`):
 * `totalRows` — ленивый геттер на сегодня, при импорте ничего не считается.
 */
export const DEMO_TABLES: TableInfo[] = [
  {
    name: DEMO_TABLE,
    engine: "MergeTree",
    get totalRows() {
      return getDemoDataAt(new Date())[DEMO_TABLE].length;
    },
  },
];

/** Совместимость: число строк по таблице — ленивый геттер на сегодня. */
export const DEMO_ROW_COUNTS: Record<string, number> = Object.defineProperty({}, DEMO_TABLE, {
  enumerable: true,
  get: () => getDemoDataAt(new Date())[DEMO_TABLE].length,
});

/** Колонки демо-датасета. */
function demoDatasetColumns(): DatasetColumn[] {
  return DEMO_COLUMNS[DEMO_TABLE].map((c) => {
    const meta = COLUMN_META[c.name as (typeof DEMO_COLUMN_NAMES)[number]];
    const datasetType: DatasetColumnType = mapClickhouseType(c.type);
    return {
      name: c.name,
      clickhouseType: c.type,
      datasetType,
      description: meta.label,
      businessContext: meta.context,
      enabled: true,
      isAutoDetected: true,
      aiDescription: meta.context,
    };
  });
}

/** Демо-датасет «Мобильный маркетинг (демо)» на таблице `installs_daily`. */
export function buildDemoDataset(now: Date): Dataset {
  return {
    id: DEMO_DATASET_ID,
    name: "Мобильный маркетинг (демо)",
    dataSourceId: DEMO_SOURCE_ID,
    table: DEMO_TABLE,
    sqlQuery: null,
    columns: demoDatasetColumns(),
    createdAt: now.toISOString(),
    rowCount: getDemoRowCounts(now)[DEMO_TABLE] ?? 0,
    calculatedFields: DEMO_CALCULATED_FIELDS[DEMO_TABLE],
    businessContext: DEMO_BUSINESS_CONTEXT,
    kpiProfile: {},
    funnelSteps: DEMO_FUNNEL_STEPS,
  };
}

// ---------------------------------------------------------------------------
// Демо-визуализации и демо-дашборды
// ---------------------------------------------------------------------------

export const DEMO_OVERVIEW_DASHBOARD_ID = "demo-dashboard-overview";
export const DEMO_PLAN_DASHBOARD_ID = "demo-dashboard-plan";
/** Префикс id объектов шаблона план/факт (визуализации, листы, виджеты). */
const PLAN_PREFIX = "demo-plan-";

const sum = (column: string): PivotValueConfig => ({ column, aggregation: "SUM" });
const SPEND = sum("spend_rub");
const INSTALLS = sum("installs");
const PURCHASES = sum("purchases");
const CPI = sum("CPI ₽");
const CPA = sum("CPA ₽");
const CTR = sum("CTR %");
const CR = sum("CR в установку %");
const ROAS = sum("ROAS %");

/** Визуализации витрины (без шаблона план/факт). id — `demo-viz-…`. */
function showcaseVisualizations(now: Date): Visualization[] {
  const createdAt = now.toISOString();
  const viz = (
    id: string,
    name: string,
    type: VisualizationType,
    config: Partial<VisualizationConfig>,
  ): Visualization => ({
    id: `demo-viz-${id}`,
    name,
    datasetId: DEMO_DATASET_ID,
    type,
    config: { rows: [], columns: [], values: [], filters: [], ...config },
    createdAt,
  });
  const chart = (xAxis: string, y: PivotValueConfig, series?: string): Partial<VisualizationConfig> => ({
    xAxis,
    yAxis: y,
    values: [y],
    ...(series ? { series } : {}),
  });
  const installsPlan = sum(planColumnName("Установки", "plan"));

  return [
    viz("spend-installs-daily", "Расход ₽ и установки по дням", "combo", {
      xAxis: "date",
      yAxis: SPEND,
      values: [SPEND, INSTALLS],
    }),
    viz("spend-daily-channel", "Расход по дням и каналам, ₽", "area", chart("date", SPEND, "channel")),
    viz("spend-share-channel", "Доля расхода по каналам", "pie", chart("channel", SPEND)),
    viz("cpi-channel", "CPI по каналам, ₽", "bar", chart("channel", CPI)),
    viz("ctr-daily-channel", "CTR по дням и каналам, %", "line", chart("date", CTR, "channel")),
    viz("channels-table", "Каналы: расход, установки, CTR, CPI, ROAS", "pivot", {
      rows: ["channel"],
      values: [SPEND, sum("spend_usd"), INSTALLS, CTR, CR, CPI, sum("CPI $"), ROAS],
    }),
    viz("installs-daily-client", "Установки по дням и клиентам", "line", chart("date", INSTALLS, "client")),
    viz("roas-client", "ROAS по клиентам, %", "bar", chart("client", ROAS)),
    viz("clients-table", "Клиенты: расход, установки, CPI, CPA, ROAS", "pivot", {
      rows: ["client"],
      values: [SPEND, INSTALLS, PURCHASES, CPI, CPA, ROAS],
    }),
    viz("revenue-usd-daily", "Выручка по дням, $", "area", chart("date", sum("revenue_usd"))),
    viz("installs-geo", "Установки по регионам", "bar", chart("geo", INSTALLS)),
    viz("cpa-geo", "CPA по регионам, ₽", "bar", chart("geo", CPA)),
    viz("installs-share-buyer", "Установки по баерам", "pie", chart("buyer", INSTALLS)),
    viz("buyers-channels-table", "Баеры × каналы: расход, ₽", "pivot", {
      rows: ["buyer"],
      columns: ["channel"],
      values: [SPEND],
    }),
    viz("plan-installs-daily", "Установки по дням: факт vs план", "combo", {
      xAxis: "date",
      yAxis: INSTALLS,
      values: [INSTALLS, installsPlan],
    }),
    viz("plan-progress", "Выполнение плана за месяц", "progress", {
      values: ["Расход", "Установки", "Покупки", "CPI", "ROAS"].map((label) =>
        sum(planColumnName(label, "completion")),
      ),
    }),
  ];
}

/** Черновик дашборда план/факт из шаблона (`buildPlanDashboard`) — общий для визуализаций и дашборда. */
function demoPlanDraft(now: Date) {
  return buildPlanDashboard(buildDemoPlanProject(now), buildDemoDataset(now), {
    breakdownColumn: ["client", "channel"],
    idPrefix: PLAN_PREFIX,
    name: "План/факт",
    now,
  });
}

/** Все демо-визуализации: витрина + визуализации шаблона план/факт. */
export function buildDemoVisualizations(now: Date): Visualization[] {
  return [...showcaseVisualizations(now), ...demoPlanDraft(now).visualizations];
}

type WidgetInput = Omit<DashboardWidget, "id" | "sheetId" | "sortOrder">;

/** Лист демо-дашборда: id виджетов — `<sheetId>-w<N>`, порядок по добавлению. */
function sheetOf(dashboardId: string, id: string, name: string, sortOrder: number, widgets: WidgetInput[]): DashboardSheet {
  const sheetId = `${dashboardId}-sheet-${id}`;
  return {
    id: sheetId,
    dashboardId,
    name,
    sortOrder,
    widgets: widgets.map((w, i) => ({ ...w, id: `${sheetId}-w${i + 1}`, sheetId, sortOrder: i })),
  };
}

const text = (title: string, body: string): WidgetInput => ({
  widgetType: "text",
  title,
  config: { text: body },
  width: "full",
});

const metric = (
  title: string,
  column: string,
  format: MetricWidgetConfig["format"],
): WidgetInput => ({
  widgetType: "metric",
  title,
  config: { column, aggregation: "SUM", format },
  width: "third",
});

const vizWidget = (vizId: string, title: string, width: DashboardWidgetWidth = "half", pivot = false): WidgetInput => ({
  widgetType: pivot ? "pivot" : "chart",
  visualizationId: `demo-viz-${vizId}`,
  title,
  config: {},
  width,
});

function overviewDashboard(now: Date, byId: Map<string, Visualization>): Dashboard {
  const id = DEMO_OVERVIEW_DASHBOARD_ID;
  const createdAt = now.toISOString();
  const w = (vizId: string, width: DashboardWidgetWidth = "half") => {
    const v = byId.get(`demo-viz-${vizId}`)!;
    return vizWidget(vizId, v.name, width, v.type === "pivot");
  };
  const sheets: DashboardSheet[] = [
    sheetOf(id, "overview", "Обзор", 0, [
      text(
        `${BRAND_NAME} — обзор`,
        "Демо-витрина на вымышленных данных мобильного маркетинга: 5 приложений, 6 каналов, 6 регионов, 5 баеров. " +
          "CPI, CTR и ROAS — вычисляемые поля датасета. Фильтры сверху меняют все графики сразу.",
      ),
      metric("Расход", "spend_rub", "currency_rub"),
      metric("Установки", "installs", "number"),
      metric("Покупки", "purchases", "number"),
      metric("CPI", "CPI ₽", "auto"),
      metric("ROAS", "ROAS %", "auto"),
      metric("CTR", "CTR %", "auto"),
      w("spend-installs-daily", "full"),
      w("spend-share-channel"),
      w("cpi-channel"),
      w("plan-progress", "full"),
    ]),
    sheetOf(id, "channels", "Каналы", 1, [
      w("spend-daily-channel", "full"),
      w("ctr-daily-channel"),
      w("cpi-channel"),
      w("channels-table", "full"),
    ]),
    sheetOf(id, "clients", "Клиенты", 2, [
      w("installs-daily-client", "full"),
      w("roas-client"),
      w("plan-installs-daily"),
      w("clients-table", "full"),
      w("revenue-usd-daily", "full"),
    ]),
    sheetOf(id, "geo-buyers", "Гео и баеры", 3, [
      w("installs-geo"),
      w("cpa-geo"),
      w("installs-share-buyer"),
      w("buyers-channels-table", "full"),
    ]),
  ];
  const filter = (column: string, label: string): DashboardFilter => ({
    id: `${id}-filter-${column}`,
    column,
    label,
    type: "multi_select",
  });
  return {
    id,
    userId: "demo",
    datasetId: DEMO_DATASET_ID,
    name: `Обзор ${BRAND_NAME}`,
    description:
      "Демо-дашборд: расход, установки, CPI и ROAS по клиентам, каналам, регионам и баерам — 4 листа на вымышленных данных.",
    filtersConfig: [
      filter("client", "Клиент"),
      filter("channel", "Канал"),
      filter("geo", "Гео"),
      filter("buyer", "Баер"),
      { id: `${id}-filter-date`, column: "date", label: "Период", type: "date_range" },
    ],
    sheets,
    createdAt,
    updatedAt: createdAt,
  };
}

function planDashboard(now: Date): Dashboard {
  const id = DEMO_PLAN_DASHBOARD_ID;
  const draft = demoPlanDraft(now);
  const createdAt = now.toISOString();
  const sheets: DashboardSheet[] = draft.sheets.map((s) => ({ ...s, dashboardId: id }));
  return {
    id,
    userId: "demo",
    datasetId: draft.datasetId,
    name: draft.name,
    description: draft.description,
    filtersConfig: draft.filtersConfig,
    sheets,
    createdAt,
    updatedAt: createdAt,
  };
}

/** Демо-дашборды: «Обзор Arrow Mobile» и «План/факт». */
export function buildDemoDashboards(now: Date): Dashboard[] {
  const byId = new Map(showcaseVisualizations(now).map((v) => [v.id, v]));
  return [overviewDashboard(now, byId), planDashboard(now)];
}

/** Демо-объект (датасет, визуализация, дашборд, лист, виджет) — живёт только в памяти. */
export function isDemoObjectId(id: string): boolean {
  return id.startsWith("demo-");
}
