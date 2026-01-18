import os
import telebot
from telebot import types
import psycopg2
from dotenv import load_dotenv
import bcrypt
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
DATABASE_URL = os.environ.get('DATABASE_URL')

if not TOKEN:
    logger.error("TELEGRAM_BOT_TOKEN is not set in environment variables!")
    # In a local/replit environment, we'll keep the process alive but idle
    # to avoid workflow restart loops, while logging the error.
    import time
    while True:
        logger.error("Waiting for TELEGRAM_BOT_TOKEN...")
        time.sleep(60)
    exit(1) 

logger.info(f"Starting bot with token prefix: {TOKEN[:5]}...")
bot = telebot.TeleBot(TOKEN, threaded=False)

# Store user state temporarily (In production, use Redis or a DB table)
user_states = {}

def get_db_connection():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        return None

@bot.message_handler(commands=['start'])
def start(message):
    try:
        markup = types.ReplyKeyboardMarkup(one_time_keyboard=True, resize_keyboard=True)
        button = types.KeyboardButton("Share Contact to Register", request_contact=True)
        markup.add(button)
        
        bot.send_message(
            message.chat.id, 
            "እንኳን ወደ Fidel Bingo በሰላም መጡ! ለመመዝገብ እባክዎ ከታች ያለውን 'Share Contact to Register' የሚለውን ቁልፍ ይጫኑ።", 
            reply_markup=markup
        )
    except Exception as e:
        logger.error(f"Error in start command: {e}")

@bot.message_handler(content_types=['contact'])
def handle_contact(message):
    if message.contact is not None:
        try:
            chat_id = str(message.chat.id)
            
            # Create inline keyboard for the website link
            markup = types.InlineKeyboardMarkup()
            
            # Use environment variable for the web URL to make it dynamic
            web_url = os.environ.get('WEB_URL', 'https://fidel-bingo.onrender.com') 
            
            web_button = types.InlineKeyboardButton("ዌብሳይት ለመክፈት ይጫኑ (Open Website)", url=web_url)
            markup.add(web_button)
            
            bot.send_message(
                message.chat.id, 
                f"የእርስዎ ቻት አይዲ (Chat ID)፡ `{chat_id}` 👈\n\nእባክዎ ይህንን ኮፒ አድርገው አፑ ላይ ይመዝገቡ።",
                parse_mode='Markdown',
                reply_markup=markup
            )
        except Exception as e:
            logger.error(f"Error in handle_contact: {e}")

if __name__ == "__main__":
    logger.info("Bot is starting polling...")
    try:
        # Try to clean up any existing webhook before starting polling
        import requests
        try:
            requests.get(f"https://api.telegram.org/bot{TOKEN}/deleteWebhook?drop_pending_updates=True", timeout=10)
            logger.info("Webhook deleted and pending updates dropped.")
        except Exception as e:
            logger.warning(f"Failed to delete webhook via requests: {e}")
            
        bot.remove_webhook()
        bot.infinity_polling(skip_pending=True, timeout=60, long_polling_timeout=60)
    except Exception as e:
        logger.error(f"Bot Polling Error: {e}")
