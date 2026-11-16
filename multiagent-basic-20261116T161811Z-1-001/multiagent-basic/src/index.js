import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AGENTS, FINAL_EDITOR, chooseAgents } from "./agents.js";
import { askLLM, loadEnv } from "./llm.js";

loadEnv();

if (process.argv.includes("--check")) {
  console.log("OK: проект мультиагента готов к запуску.");
  console.log("Команда для демо: npm run demo");
  process.exit(0);
}

const userRequest = await getUserRequest();
const routingMode = process.env.ROUTING_MODE || "auto";
const selectedAgentKeys = chooseAgents(userRequest, routingMode);

console.log("\nЗапрос пользователя:");
console.log(userRequest);

console.log("\nДиспетчер выбрал субагентов:");
for (const key of selectedAgentKeys) {
  console.log(`- ${AGENTS[key].title}: ${AGENTS[key].description}`);
}

const agentResults = [];

for (const key of selectedAgentKeys) {
  const agent = AGENTS[key];

  console.log(`\n=== Работает субагент: ${agent.title} ===`);

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
}

const editorInput = buildEditorInput(userRequest, agentResults);

console.log("\n=== Финальная сборка ответа ===");

const finalAnswer = await askLLM({
  agentKey: "final",
  agentTitle: FINAL_EDITOR.title,
  system: FINAL_EDITOR.system,
  user: editorInput,
});

console.log(finalAnswer);

function buildEditorInput(request, results) {
  const parts = results.map((result) => {
    return `## ${result.title}\n${result.answer}`;
  });

  return `Исходный запрос пользователя:
${request}

Ответы субагентов:
${parts.join("\n\n")}`;
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
