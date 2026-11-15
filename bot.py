import asyncio
import logging
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# ==========================================
# ВСТАВЬ СВОЙ ТОКЕН СЮДА (между кавычками!)
# ==========================================
BOT_TOKEN = import os
from dotenv import load_dotenv
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")

# Настройка бота
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# Класс для хранения состояний (чтобы бот помнил, что мы ввели)
class CalcStates(StatesGroup):
    waiting_for_buy_price = State()
    waiting_for_sell_price = State()

# Обработчик команды /start
@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear() # Сбрасываем старые данные
    await message.answer(
        "Привет! Я бот-калькулятор для селлеров. 🛒\n"
        "Я помогу посчитать твою маржу.\n\n"
        "Шаг 1: Введи цену закупки товара (в рублях, только число):"
    )
    # Переводим бота в состояние ожидания цены закупки
    await state.set_state(CalcStates.waiting_for_buy_price)

# Ловим цену закупки
@dp.message(CalcStates.waiting_for_buy_price)
async def process_buy_price(message: types.Message, state: FSMContext):
    try:
        buy_price = float(message.text) # Пытаемся превратить текст в число
        await state.update_data(buy_price=buy_price) # Запоминаем цену
        
        await message.answer("Отлично! Шаг 2: Теперь введи цену продажи (в рублях, только число):")
        await state.set_state(CalcStates.waiting_for_sell_price)
    except ValueError:
        await message.answer("Пожалуйста, введи число (например: 1500). Без букв и пробелов.")

# Ловим цену продажи и считаем
@dp.message(CalcStates.waiting_for_sell_price)
async def process_sell_price(message: types.Message, state: FSMContext):
    try:
        sell_price = float(message.text)
        
        # Достаем цену закупки из памяти
        user_data = await state.get_data()
        buy_price = user_data.get('buy_price', 0)
        
        # Считаем маржу
        margin_rub = sell_price - buy_price
        margin_percent = (margin_rub / sell_price) * 100 if sell_price > 0 else 0
        
        # Формируем ответ
        result_text = (
            f"📊 Твои результаты:\n"
            f"Цена закупки: {buy_price} руб.\n"
            f"Цена продажи: {sell_price} руб.\n\n"
            f"💰 Маржа: {margin_rub} руб.\n"
            f"📈 Маржинальность: {margin_percent:.1f}%\n\n"
            f"Чтобы посчитать заново, напиши /start"
        )
        
        await message.answer(result_text)
        await state.clear() # Очищаем память после расчета
        
    except ValueError:
        await message.answer("Пожалуйста, введи число (например: 3000). Без букв.")

# Запуск бота
async def main():
    logging.basicConfig(level=logging.INFO)
    print("Бот запускается...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())