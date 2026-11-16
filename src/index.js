import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { AGENTS, FINAL_EDITOR, chooseAgents } from "./agents.js";
import { askLLM, loadEnv } from "./llm.js";
import { PROFILE, brandLine, profilePath } from "./profile.js";

loadEnv();

if (process.argv.includes("--demo")) {
  process.env.AI_PROVIDER = "demo";
}

const provider = process.env.AI_PROVIDER || "demo";
const routingMode = process.env.ROUTING_MODE || "auto";

if (process.argv.includes("--check")) {
  printHealthCheck();
  process.exit(0);
}

const userRequest = await getUserRequest();

console.log("\nЗапрос пользователя:");
console.log(userRequest);

console.log(`\nПрофиль: ${brandLine()}`);
console.log(`Провайдер: ${provider} | Маршрутизация: ${routingMode}`);

const selectedAgentKeys = chooseAgents(userRequest, routingMode);

console.log("\nДиспетчер выбрал субагентов:");
for (const key of selectedAgentKeys) {
  console.log(`- ${AGENTS[key].title}: ${AGENTS[key].description}`);
}

const agentResults = [];

for (const key of selectedAgentKeys) {
  const agent = AGENTS[key];

  console.log(`\n=== Работает субагент: ${agent.title} ===`);

  try {
    const answer = await askLLM({
      agentKey: key,
      agentTitle: agent.title,
      system: agent.system,
      user: userRequest,
    });

    agentResults.push({
      key,
      title: agent.title,
      answer,
    });

    console.log(answer);
  } catch (error) {
    console.error(`\nОшибка в агенте "${agent.title}": ${error.message}`);
    console.error("Подсказка: проверьте .env или запустите демо-режим: npm run demo");
    process.exit(1);
  }
}

const editorInput = buildEditorInput(userRequest, agentResults);

console.log("\n=== Финальная сборка ответа ===");

try {
  const finalAnswer = await askLLM({
    agentKey: "final",
    agentTitle: FINAL_EDITOR.title,
    system: FINAL_EDITOR.system,
    user: editorInput,
  });

  console.log(finalAnswer);
} catch (error) {
  console.error(`\nОшибка в финальном редакторе: ${error.message}`);
  console.error("Подсказка: проверьте .env или запустите демо-режим: npm run demo");
  process.exit(1);
}

function buildEditorInput(request, results) {
  const parts = results.map((result) => {
    return `## ${result.title}\n${result.answer}`;
  });

  return `Исходный запрос пользователя:
${request}

Ответы субагентов:
${parts.join("\n\n")}`;
}

function printHealthCheck() {
  const envPath = path.join(process.cwd(), ".env");
  const hasEnv = fs.existsSync(envPath);

  console.log("OK: проект мультиагента готов к запуску.");
  console.log(`Node.js: ${process.version}`);
  console.log(`Провайдер: ${provider}`);
  console.log(`Маршрутизация: ${routingMode}`);
  console.log(`Профиль: ${profilePath}`);
  console.log(`Бренд: ${PROFILE.owner.brand || "не задан"}`);
  console.log(`Ключ OpenAI: ${process.env.OPENAI_API_KEY ? "найден" : "не найден"}`);
  console.log(`Telegram-публикация: ${process.env.POST_TO_TELEGRAM || "false"}`);

  if (!hasEnv) {
    console.log("\nВнимание: в текущей папке нет .env. Скопируйте .env.example в .env.");
  }

  if (provider === "demo") {
    console.log("Режим demo: ключи не нужны, ответы-заглушки.");
    console.log("\nДемо: npm run demo");
  } else {
    console.log(`\nРеальный режим: npm start "ваш запрос"`);
  }
}

async function getUserRequest() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (args.length > 0) {
    return args.join(" ");
  }

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Введите запрос для мультиагента: ");
  rl.close();

  if (!answer.trim()) {
    console.error("Запрос пустой. Запустите еще раз и передайте задачу.");
    process.exit(1);
  }

  return answer.trim();
}
