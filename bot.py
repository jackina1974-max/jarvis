import os
import math
import asyncio
import logging
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, BaseMiddleware, types
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# Лимит на вводимые суммы: защита от опечаток вида 10000000000
MAX_PRICE = 100_000_000

# Загружаем токен из скрытого файла .env
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")

# Без токена бот упадёт только на первом запросе и с непонятной ошибкой,
# поэтому проверяем сразу при старте
if not BOT_TOKEN:
    raise SystemExit("BOT_TOKEN не найден. Проверь файл .env в папке проекта.")

# Настройка бота
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# Класс для хранения состояний (чтобы бот помнил, что мы ввели)
class CalcStates(StatesGroup):
    waiting_for_buy_price = State()
    waiting_for_sell_price = State()


def parse_price(text: str | None) -> float:
    """Превращает текст в цену. Кидает ValueError, если это не число."""
    if text is None:
        raise ValueError("Пустое сообщение")
    # Убираем пробелы, неразрывные пробелы и запятую как десятичный разделитель
    cleaned = text.strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not cleaned:
        raise ValueError("Пустое сообщение")
    price = float(cleaned)
    # nan и inf проходят проверки ниже: любое сравнение с nan даёт False,
    # а inf больше любой разумной суммы, но проверяем оба явно
    if not math.isfinite(price):
        raise ValueError("Некорректное число")
    if price <= 0:
        raise ValueError("Цена должна быть больше нуля")
    if price > MAX_PRICE:
        raise ValueError("Слишком большая сумма")
    return price


def money(value: float) -> str:
    """Красиво форматирует сумму: 12345.5 -> '12 345,50'."""
    formatted = f"{value:,.2f}".replace(",", "\u00a0").replace(".", ",")
    return f"{formatted} руб."


class SkipCommands(BaseMiddleware):
    """Пропускает команды мимо обработчиков состояний.

    Без этого /start в середине диалога не срабатывает: сообщение сначала
    попадает в обработчик состояния, тот пытается сделать float('/start')
    и отвечает ошибкой. Теперь команды всегда обрабатываются своими хендлерами.
    """

    async def __call__(self, handler, event: types.Message, data: dict):
        if event.text and event.text.startswith("/"):
            return
        return await handler(event, data)


dp.message.middleware(SkipCommands())


# Обработчик команды /start
@dp.message(CommandStart())
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()  # Сбрасываем старые данные
    await message.answer(
        "Привет! Я бот-калькулятор для селлеров. 🛒\n"
        "Я помогу посчитать твою маржу.\n\n"
        "Шаг 1: Введи цену закупки товара (в рублях, только число):"
    )
    # Переводим бота в состояние ожидания цены закупки
    await state.set_state(CalcStates.waiting_for_buy_price)


# Отмена расчёта на любом шаге
@dp.message(Command("cancel"))
async def cmd_cancel(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("Ок, расчёт отменён. Чтобы начать заново, напиши /start")


# Ловим цену закупки
@dp.message(CalcStates.waiting_for_buy_price)
async def process_buy_price(message: types.Message, state: FSMContext):
    try:
        buy_price = parse_price(message.text)  # Пытаемся превратить текст в число
    except ValueError:
        await message.answer("Пожалуйста, введи число больше нуля (например: 1500). Без букв.")
        return

    await state.update_data(buy_price=buy_price)  # Запоминаем цену
    await message.answer("Отлично! Шаг 2: Теперь введи цену продажи (в рублях, только число):")
    await state.set_state(CalcStates.waiting_for_sell_price)


# Ловим цену продажи и считаем
@dp.message(CalcStates.waiting_for_sell_price)
async def process_sell_price(message: types.Message, state: FSMContext):
    try:
        sell_price = parse_price(message.text)
    except ValueError:
        await message.answer("Пожалуйста, введи число больше нуля (например: 3000). Без букв.")
        return

    # Достаем цену закупки из памяти
    user_data = await state.get_data()
    buy_price = user_data.get("buy_price")

    # Страховка: если данных нет (например, бот перезапускался) — начинаем заново
    if buy_price is None:
        await state.clear()
        await message.answer("Данные потерялись. Давай заново: напиши /start")
        return

    # Считаем маржу
    margin_rub = sell_price - buy_price
    margin_percent = (margin_rub / sell_price) * 100
    markup_percent = (margin_rub / buy_price) * 100

    # Формируем ответ
    result_text = (
        "📊 Твои результаты:\n"
        f"Цена закупки: {money(buy_price)}\n"
        f"Цена продажи: {money(sell_price)}\n\n"
        f"💰 Маржа: {money(margin_rub)}\n"
        f"📈 Маржинальность (от цены продажи): {margin_percent:.1f}%\n"
        f"🏷 Наценка (от цены закупки): {markup_percent:.1f}%\n\n"
        "Чтобы посчитать заново, напиши /start"
    )

    await message.answer(result_text)
    await state.clear()  # Очищаем память после расчета


# Запуск бота


# Глобальный перехват ошибок: одна упавшая отправка не должна останавливать поллинг
@dp.errors()
async def on_error(event: types.ErrorEvent):
    logging.exception(
        "Ошибка при обработке апдейта: %s",
        event.exception,
        exc_info=event.exception,
    )
    # True = ошибка обработана, поллинг продолжается
    return True


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logging.info("Бот запускается...")
    try:
        await dp.start_polling(bot)
    except Exception:
        # Сеть, неверный токен, конфликт с другим экземпляром — логируем и выходим
        logging.exception("Поллинг остановился из-за ошибки")
    finally:
        # Корректно закрываем сессию, иначе на Windows бывают предупреждения
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("Бот остановлен.")
