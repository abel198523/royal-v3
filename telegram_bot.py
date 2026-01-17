import os
import telebot
from telebot import types
import psycopg2
from dotenv import load_dotenv
import bcrypt

load_dotenv()

TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
DATABASE_URL = os.getenv('DATABASE_URL')

bot = telebot.TeleBot(TOKEN, threaded=False)

# Store user state temporarily (In production, use Redis or a DB table)
user_states = {}

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

@bot.message_handler(commands=['start'])
def start(message):
    markup = types.ReplyKeyboardMarkup(one_time_keyboard=True, resize_keyboard=True)
    button = types.KeyboardButton("Share Contact to Register", request_contact=True)
    markup.add(button)
    
    bot.send_message(
        message.chat.id, 
        "እንኳን ወደ Fidel Bingo በሰላም መጡ! ለመመዝገብ እባክዎ ከታች ያለውን 'Share Contact to Register' የሚለውን ቁልፍ ይጫኑ።", 
        reply_markup=markup
    )

@bot.message_handler(content_types=['contact'])
def handle_contact(message):
    if message.contact is not None:
        chat_id = str(message.chat.id)
        
        # Create inline keyboard for the website link
        markup = types.InlineKeyboardMarkup()
        web_button = types.InlineKeyboardButton("ዌብሳይት ለመክፈት ይጫኑ (Open Website)", url="https://2bb76bef-ba0f-4367-944c-acff8aa5718b-00-tfnvmmk0ke2o.picard.replit.dev")
        markup.add(web_button)
        
        bot.send_message(
            message.chat.id, 
            f"የእርስዎ ቻት አይዲ (Chat ID)፡ `{chat_id}` 👈\n\nእባክዎ ይህንን ኮፒ አድርገው አፑ ላይ ይመዝገቡ።",
            parse_mode='Markdown',
            reply_markup=markup
        )

# Remove unused password step logic if you want to keep the file clean
# But for now, we'll just leave it and only the contact handler is active.

if __name__ == "__main__":
    print("Bot is starting...")
    bot.infinity_polling()
