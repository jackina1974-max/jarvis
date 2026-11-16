import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./profile.js";

export function loadEnv() {
  const candidates = [path.join(process.cwd(), ".env"), path.join(projectRoot, ".env")];
  const envFile = candidates.find((file) => fs.existsSync(file));

  if (!envFile) return;

  const text = fs.readFileSync(envFile, "utf8");

  // split(/\r?\n/) обязателен для Windows: иначе в значениях остается символ \r
  for (const line of text.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim();
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = cleanValue(trimmed.slice(eqIndex + 1));

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function cleanValue(rawValue) {
  const value = rawValue.trim();

  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export async function askLLM({ agentKey, agentTitle, system, user }) {
  const provider = process.env.AI_PROVIDER || "demo";

  if (provider === "openai") {
    return askOpenAI({ system, user });
  }

  if (provider === "anthropic") {
    return askAnthropic({ system, user });
  }

  return demoAnswer({ agentKey, agentTitle, user });
}

async function askOpenAI({ system, user }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Не найден OPENAI_API_KEY. Добавьте ключ в .env или поставьте AI_PROVIDER=demo.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: system,
        },
        {
          role: "user",
          content: user,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.output_text || JSON.stringify(data, null, 2);
}

async function askAnthropic({ system, user }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Не найден ANTHROPIC_API_KEY. Добавьте ключ в .env или поставьте AI_PROVIDER=demo.");
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system,
      messages: [
        {
          role: "user",
          content: user,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.content?.map((item) => item.text).join("\n") || JSON.stringify(data, null, 2);
}

function demoAnswer({ agentKey, agentTitle, user }) {
  const request = user.length > 180 ? `${user.slice(0, 180)}...` : user;

  if (agentKey === "analyst") {
    return `Демо-ответ агента "${agentTitle}".

Запрос: ${request}

1. Главная цель: понять, какой результат нужен пользователю и зачем.
2. Аудитория: люди, которым нужно простое решение без сложной технической настройки.
3. Что уточнить: кто конечный пользователь, какой результат считается успехом, какие сроки.
4. Риски: можно сразу уйти в слишком сложную систему.
5. Первый шаг: описать MVP в 3-5 функциях.`;
  }

  if (agentKey === "tech") {
    return `Демо-ответ агента "${agentTitle}".

1. Инструменты: простой сайт/бот, таблица для данных, один API для ИИ.
2. Архитектура: пользователь -> форма/бот -> обработчик -> база/таблица -> ответ.
3. MVP: сделать только главный сценарий, без личных кабинетов и сложной админки.
4. Пошагово: создать папку проекта, описать README, сделать форму, сохранить заявку, отправить уведомление.
5. Не делать сначала: сложную авторизацию, платежи, много ролей и лишнюю автоматизацию.`;
  }

  if (agentKey === "marketer") {
    return `Демо-ответ агента "${agentTitle}".

1. Боль: клиент хочет быстро получить понятный результат.
2. Оффер: "Соберем рабочий MVP за короткий срок и проверим спрос".
3. Проверка спроса: запустить простую страницу и собрать 10-20 заявок.
4. Монетизация: консультация, настройка под ключ, ежемесячная поддержка.
5. Первый шаг: сформулировать один конкретный результат, который покупатель получит.`;
  }

  return `Демо-ответ агента "${agentTitle}".

Короткий вывод: задачу лучше разбить на роли и собрать простой MVP.

Что предлагают субагенты:
- аналитик: уточнить цель и риски;
- технарь: собрать минимальный рабочий сценарий;
- маркетолог: упаковать результат в понятный оффер.

Пошаговый план:
1. Описать целевого пользователя.
2. Выбрать один главный сценарий.
3. Собрать простую версию.
4. Проверить на реальных людях.
5. Потом добавлять автоматизацию.

Первым делом: сформулировать, какой один результат должен получить пользователь.`;
}

