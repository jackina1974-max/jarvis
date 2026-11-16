import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadEnv } from "./llm.js";

loadEnv();

// --demo включает безопасный режим: без API и без публикации в реальный канал.
if (process.argv.includes("--demo")) {
  process.env.CONTENT_PROVIDER = "demo";
}

const rootDir = process.cwd();
const topicsPath = path.join(rootDir, "content-topics.json");
const statePath = path.join(rootDir, "outputs", "autopost-state.json");
const logPath = path.join(rootDir, "outputs", "autopost.log");
const scheduleTimes = parseSchedule(process.env.AUTOPOST_TIMES || "09:00,14:00,19:00");
const runOnce = process.argv.includes("--once");
const runNow = process.argv.includes("--now");
const showHelp = process.argv.includes("--help") || process.argv.includes("-h");

if (showHelp) {
  printHelp();
  process.exit(0);
}

await fs.mkdir(path.join(rootDir, "outputs"), { recursive: true });

if (runOnce) {
  try {
    await runAutopost();
    process.exit(0);
  } catch (error) {
    const message = `[${new Date().toISOString()}] ERROR: ${error.message}`;
    await appendLog(message);
    console.error(`Ошибка автопостинга: ${error.message}`);
    process.exit(1);
  }
}

console.log("Автопостинг запущен");
console.log(`Провайдер: ${process.env.CONTENT_PROVIDER || "demo"}`);
console.log(`Расписание: ${scheduleTimes.map(formatTime).join(", ")}`);
console.log(`Темы: ${topicsPath}`);
console.log(`Лог: ${logPath}`);

if (runNow) {
  await runAutopost();
}

scheduleNextRun();

function scheduleNextRun() {
  const now = new Date();
  const nextRun = getNextRunDate(now, scheduleTimes);
  const delay = nextRun.getTime() - now.getTime();

  console.log(`Следующий запуск: ${nextRun.toLocaleString("ru-RU")}`);

  setTimeout(async () => {
    await runAutopost().catch((error) => {
      console.error(`Ошибка автопостинга: ${error.message}`);
    });
    scheduleNextRun();
  }, delay);
}

async function runAutopost() {
  const startedAt = new Date().toISOString();
  const topic = await pickNextTopic();

  await appendLog(`[${startedAt}] START: ${topic}`);
  console.log(`\nЗапускаю автопост: ${topic}`);

  const code = await runContentPipeline(topic);
  const finishedAt = new Date().toISOString();

  if (code !== 0) {
    await appendLog(`[${finishedAt}] FAIL (${code}): ${topic}`);
    throw new Error(`content-pipeline finished with code ${code}`);
  }

  await markTopicPosted(topic, startedAt, finishedAt);
  await appendLog(`[${finishedAt}] OK: ${topic}`);
  console.log(`Автопост готов: ${topic}`);
}

async function runContentPipeline(topic) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/content-pipeline.js", topic], {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    });

    child.on("close", resolve);
  });
}

async function pickNextTopic() {
  const topics = await readTopics();
  const state = await readState();
  const posted = new Set((state.postedTopics || []).map((item) => item.topic));
  const nextTopic = topics.find((topic) => !posted.has(topic));

  if (nextTopic) return nextTopic;

  await writeState({
    ...state,
    postedTopics: [],
    cyclesCompleted: (state.cyclesCompleted || 0) + 1,
    lastResetAt: new Date().toISOString(),
  });

  return topics[0];
}

async function markTopicPosted(topic, startedAt, finishedAt) {
  const state = await readState();
  const postedTopics = state.postedTopics || [];

  postedTopics.push({
    topic,
    startedAt,
    finishedAt,
  });

  await writeState({
    ...state,
    postedTopics,
    updatedAt: finishedAt,
  });
}

async function readTopics() {
  const text = await fs.readFile(topicsPath, "utf8");
  const data = JSON.parse(text);
  const topics = Array.isArray(data) ? data : data.topics;

  if (!Array.isArray(topics)) {
    throw new Error("content-topics.json должен быть массивом строк или объектом { topics: [...] }.");
  }

  const cleanTopics = topics.map((item) => String(item).trim()).filter(Boolean);

  if (cleanTopics.length === 0) {
    throw new Error("В content-topics.json нет тем для автопостинга.");
  }

  return cleanTopics;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeState(state) {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function appendLog(line) {
  await fs.appendFile(logPath, `${line}\n`, "utf8");
}

function parseSchedule(value) {
  const times = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseTime)
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);

  if (times.length === 0) {
    throw new Error("AUTOPOST_TIMES должен содержать хотя бы одно время, например 09:00,14:00,19:00.");
  }

  return times;
}

function parseTime(value) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    throw new Error(`Некорректное время "${value}". Используйте формат HH:MM.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    throw new Error(`Некорректное время "${value}".`);
  }

  return { hour, minute };
}

function getNextRunDate(now, times) {
  for (const time of times) {
    const candidate = new Date(now);
    candidate.setHours(time.hour, time.minute, 0, 0);

    if (candidate > now) return candidate;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(times[0].hour, times[0].minute, 0, 0);
  return tomorrow;
}

function formatTime(time) {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function printHelp() {
  console.log(`Контентный автопостер

Команды:
  npm run content:auto          Опубликовать одну следующую тему и выйти
  npm run content:scheduler     Запустить постоянный планировщик
  npm run content:scheduler:now Запустить планировщик и сразу сделать первый пост

Флаг:
  --demo                        Безопасный прогон: без API и без публикации в Telegram

Настройка:
  AUTOPOST_TIMES=09:00,14:00,19:00
  PROFILE_PATH=profile.json (необязательно, альтернативный профиль)

Темы берутся из content-topics.json.
`);
}
