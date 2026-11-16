import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnv } from "./llm.js";

loadEnv();

const topic = await getTopic();
const runId = makeRunId();
const outputDir = path.join("outputs", "content-runs", runId);
await fs.mkdir(outputDir, { recursive: true });

console.log("\nКонтентный мультиагент запущен");
console.log(`Тема: ${topic}`);
console.log(`Папка результата: ${outputDir}`);

const research = await runResearchAgent(topic);
await fs.writeFile(path.join(outputDir, "01-research.md"), research, "utf8");

const post = await runCopywriterAgent(topic, research);
await fs.writeFile(path.join(outputDir, "02-post.md"), post, "utf8");

const imageResult = await runImageAgent(topic, research, post, outputDir);

const telegramResult = await runTelegramAgent({
  topic,
  post,
  imagePath: imageResult.path,
});

const report = {
  topic,
  runId,
  provider: process.env.CONTENT_PROVIDER || "demo",
  files: {
    research: path.join(outputDir, "01-research.md"),
    post: path.join(outputDir, "02-post.md"),
    image: imageResult.path,
  },
  telegram: telegramResult,
};

await fs.writeFile(path.join(outputDir, "run-report.json"), JSON.stringify(report, null, 2), "utf8");

console.log("\n=== Итог ===");
console.log(`Исследование: ${report.files.research}`);
console.log(`Пост: ${report.files.post}`);
console.log(`Картинка: ${report.files.image}`);
console.log(`Telegram: ${telegramResult.status}`);
console.log("\nГотовый пост:\n");
console.log(post);

async function runResearchAgent(userTopic) {
  console.log("\n1. Агент-исследователь собирает информацию...");

  const provider = process.env.CONTENT_PROVIDER || "demo";
  const useWebSearch = (process.env.USE_WEB_SEARCH || "true") === "true";

  if (provider !== "openai") {
    return demoResearch(userTopic);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Нет OPENAI_API_KEY. Добавьте ключ в .env или поставьте CONTENT_PROVIDER=demo.");
  }

  const tools = useWebSearch ? [{ type: "web_search" }] : [];
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

  const inputPrompt = `Ты агент-исследователь.
Найди актуальную и полезную информацию по теме:
"${userTopic}"

Верни:
1. 5-7 ключевых фактов;
2. 3 практических вывода;
3. возможные риски или спорные моменты;
4. 3 идеи для Telegram-поста;
5. ссылки на источники, если они доступны.

Пиши по-русски, компактно, без воды.`;

  return openAIResponseText({
    apiKey,
    model,
    tools,
    input: inputPrompt,
  });
}

async function runCopywriterAgent(userTopic, research) {
  console.log("\n2. Агент-копирайтер пишет Telegram-пост...");

  const provider = process.env.CONTENT_PROVIDER || "demo";

  if (provider !== "openai") {
    return demoPost(userTopic, research);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Нет OPENAI_API_KEY. Добавьте ключ в .env или поставьте CONTENT_PROVIDER=demo.");
  }

  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

  const inputPrompt = `Ты копирайтер для Telegram.
На основе исследования напиши пост.

Тема:
${userTopic}

Исследование:
${research}

Требования:
- 1200-1800 знаков;
- простой живой язык;
- сильный первый абзац;
- структура с короткими абзацами;
- 3-5 практических пунктов;
- без агрессивных обещаний;
- в конце мягкий CTA: задать вопрос / сохранить / написать в комментарии.

Верни только готовый текст поста.`;

  return openAIResponseText({
    apiKey,
    model,
    tools: [],
    input: inputPrompt,
  });
}

async function runImageAgent(userTopic, research, post, dir) {
  console.log("\n3. Агент-дизайнер генерирует картинку...");

  const provider = process.env.CONTENT_PROVIDER || "demo";
  const generateRealImage = (process.env.GENERATE_REAL_IMAGE || "false") === "true";

  if (provider !== "openai" || !generateRealImage) {
    const svgPath = path.join(dir, "03-image-demo.svg");
    await fs.writeFile(svgPath, demoSvg(userTopic), "utf8");
    return {
      status: "demo",
      path: svgPath,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Нет OPENAI_API_KEY. Добавьте ключ в .env или поставьте GENERATE_REAL_IMAGE=false.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-5.5";
  const imagePrompt = `Создай обложку для Telegram-поста.

Тема: ${userTopic}

Смысл поста:
${post.slice(0, 1200)}

Стиль:
- современная clean digital illustration;
- формат квадрат 1:1;
- без мелкого текста;
- без логотипов известных брендов;
- подходит для бизнес/AI Telegram-канала;
- визуально понятно даже без подписи.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: imagePrompt,
      tools: [{ type: "image_generation" }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI image generation error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const imageBase64 = data.output
    ?.filter((item) => item.type === "image_generation_call")
    ?.map((item) => item.result)
    ?.find(Boolean);

  if (!imageBase64) {
    throw new Error("OpenAI не вернул image_generation_call.result.");
  }

  const pngPath = path.join(dir, "03-image.png");
  await fs.writeFile(pngPath, Buffer.from(imageBase64, "base64"));

  return {
    status: "generated",
    path: pngPath,
  };
}

async function runTelegramAgent({ post, imagePath }) {
  console.log("\n4. Telegram-агент публикует пост...");

  const shouldPost = (process.env.POST_TO_TELEGRAM || "false") === "true";

  if (!shouldPost) {
    console.log("Демо-режим: публикация в Telegram выключена.");
    return {
      status: "demo: not posted",
      details: "POST_TO_TELEGRAM=false",
    };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Для публикации нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env.");
  }

  if (imagePath && /\.(png|jpg|jpeg|webp)$/i.test(imagePath)) {
    const url = `https://api.telegram.org/bot${token}/sendPhoto`;
    const bytes = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", truncateTelegramCaption(post));
    form.append("photo", new Blob([bytes], { type: mimeType }), path.basename(imagePath));

    const response = await fetch(url, {
      method: "POST",
      body: form,
    });

    return parseTelegramResponse(response);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: post,
      disable_web_page_preview: false,
    }),
  });

  return parseTelegramResponse(response);
}

async function openAIResponseText({ apiKey, model, tools, input }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      tools,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.output_text || extractOutputText(data) || JSON.stringify(data, null, 2);
}

function extractOutputText(data) {
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function parseTelegramResponse(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Telegram API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return {
    status: "posted",
    message_id: data?.result?.message_id,
  };
}

function truncateTelegramCaption(text) {
  if (text.length <= 1000) return text;
  return `${text.slice(0, 997)}...`;
}

async function getTopic() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (args.length > 0) return args.join(" ");

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Введите тему для Telegram-поста: ");
  rl.close();

  if (!answer.trim()) {
    console.error("Тема пустая. Запустите еще раз и передайте тему.");
    process.exit(1);
  }

  return answer.trim();
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function demoResearch(userTopic) {
  return `# Демо-исследование

Тема: ${userTopic}

## Ключевые факты

1. Люди лучше реагируют на практические примеры, чем на абстрактные рассуждения.
2. Для Telegram важен сильный первый абзац: он решает, дочитают ли пост.
3. Хороший пост должен давать одну главную мысль, а не десять разных тем.
4. Визуал повышает заметность поста в ленте.
5. Лучше публиковать меньше, но понятнее и полезнее.

## Практические выводы

1. Пост должен отвечать на конкретную боль аудитории.
2. В посте нужны короткие абзацы и ясная структура.
3. Картинка должна усиливать смысл, а не просто украшать.

## Идеи для поста

1. "Почему бизнесу не нужен сложный ИИ на старте".
2. "Как проверить идею автоматизации за один день".
3. "Какие ошибки мешают внедрять ИИ без хаоса".`;
}

function demoPost(userTopic) {
  return `Многие пытаются внедрить ИИ слишком сложно: сразу агенты, CRM, автоворонки, базы данных, интеграции и еще десять модных слов сверху.

Но на практике почти всегда нужен не "космический корабль", а один понятный рабочий сценарий.

Тема: ${userTopic}

С чего начать:

1. Выберите одну боль
Например: долго отвечаем клиентам, теряем заявки, вручную переносим данные, забываем follow-up.

2. Опишите простой результат
Не "сделать ИИ-систему", а "бот принимает заявку и отправляет менеджеру в Telegram".

3. Соберите MVP
Одна форма, одна таблица, одно уведомление. Уже можно тестировать.

4. Проверьте на реальных людях
Если никто не пользуется простой версией, сложная версия тоже не спасет.

5. Потом добавляйте автоматизацию
AI-ответы, CRM, оплату, базу знаний и аналитику лучше подключать после проверки главного сценария.

Главная мысль: хороший ИИ-проект начинается не с технологий, а с ясной задачи.

Сохраните этот подход, если планируете запускать своего агента или автоматизацию.`;
}

function demoSvg(userTopic) {
  const safeTopic = escapeXml(userTopic.slice(0, 80));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#0f172a"/>
  <circle cx="880" cy="160" r="180" fill="#2563eb" opacity="0.35"/>
  <circle cx="160" cy="900" r="220" fill="#22c55e" opacity="0.24"/>
  <rect x="110" y="150" width="860" height="780" rx="44" fill="#ffffff" opacity="0.94"/>
  <text x="150" y="250" fill="#2563eb" font-family="Arial, sans-serif" font-size="44" font-weight="700">Контентный мультиагент</text>
  <text x="150" y="360" fill="#111827" font-family="Arial, sans-serif" font-size="58" font-weight="800">Исследование</text>
  <text x="150" y="440" fill="#111827" font-family="Arial, sans-serif" font-size="58" font-weight="800">Пост</text>
  <text x="150" y="520" fill="#111827" font-family="Arial, sans-serif" font-size="58" font-weight="800">Картинка</text>
  <text x="150" y="600" fill="#111827" font-family="Arial, sans-serif" font-size="58" font-weight="800">Telegram</text>
  <line x1="150" y1="660" x2="930" y2="660" stroke="#d1d5db" stroke-width="3"/>
  <foreignObject x="150" y="700" width="780" height="160">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 34px; line-height: 1.25; color: #334155;">
      ${safeTopic}
    </div>
  </foreignObject>
</svg>`;
}

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
