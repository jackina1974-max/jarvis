import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_PROFILE = {
  owner: {
    name: "",
    brand: "мультиагент",
    channel: "",
  },
  niche: "ИИ и автоматизация для малого бизнеса",
  audience: "предприниматели и небольшие команды, которым нужен простой результат без сложной разработки",
  tone: "просто и по делу: короткие абзацы, живой язык, без канцелярита и громких обещаний",
  cta: "задать вопрос в комментариях или сохранить пост",
  postLength: "1200-1800 знаков",
  hashtags: [],
  keywords: {
    tech: [
      "сайт",
      "бот",
      "прилож",
      "код",
      "api",
      "интеграц",
      "автоматизац",
      "telegram",
      "whatsapp",
      "crm",
      "supabase",
      "база",
      "сервер",
    ],
    marketing: [
      "продаж",
      "монет",
      "клиент",
      "оффер",
      "лендинг",
      "реклам",
      "заявк",
      "услуг",
      "цена",
      "пакет",
      "аудитор",
      "запуск",
    ],
  },
};

// Объявлено до вызова loadProfile(), чтобы warnOnce работал при отсутствии profile.json.
const warned = new Set();

export const profilePath =
  process.env.PROFILE_PATH || path.join(projectRoot, "profile.json");

export const PROFILE = loadProfile();

function loadProfile() {
  const raw = readProfileFile();

  if (!raw) {
    warnOnce(
      `Файл профиля не найден: ${profilePath}. Использую встроенные настройки по умолчанию.`,
    );
    return DEFAULT_PROFILE;
  }

  return {
    ...DEFAULT_PROFILE,
    ...raw,
    owner: { ...DEFAULT_PROFILE.owner, ...(raw.owner || {}) },
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : DEFAULT_PROFILE.hashtags,
    keywords: {
      ...DEFAULT_PROFILE.keywords,
      ...(raw.keywords || {}),
    },
  };
}

function readProfileFile() {
  try {
    return JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Не удалось прочитать ${profilePath}: ${error.message}`);
  }
}

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[profile] ${message}`);
}

export function brandLine() {
  const { brand, channel, name } = PROFILE.owner;
  const parts = [];

  if (brand) parts.push(`бренд: ${brand}`);
  if (channel) parts.push(`канал: ${channel}`);
  if (name) parts.push(`автор: ${name}`);

  return parts.length > 0 ? parts.join(", ") : "учебный проект без бренда";
}

export function personaIntro() {
  return `Ниша проекта: ${PROFILE.niche}.
Аудитория: ${PROFILE.audience}.
Тон общения: ${PROFILE.tone}.
Подпись/контекст бренда: ${brandLine()}.`;
}

export function routingKeywords() {
  return {
    tech: PROFILE.keywords.tech?.length > 0 ? PROFILE.keywords.tech : DEFAULT_PROFILE.keywords.tech,
    marketing:
      PROFILE.keywords.marketing?.length > 0
        ? PROFILE.keywords.marketing
        : DEFAULT_PROFILE.keywords.marketing,
  };
}

export function hashtagBlock() {
  return Array.isArray(PROFILE.hashtags) && PROFILE.hashtags.length > 0
    ? `\n\n${PROFILE.hashtags.map((tag) => `#${String(tag).replace(/^#/, "")}`).join(" ")}`
    : "";
}
