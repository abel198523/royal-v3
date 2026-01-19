from flask import render_template, request, jsonify, redirect, url_for
from app import app, db
from models import User, Room, Transaction

@app.route("/")
def index():
    rooms = Room.query.all()
    # Find the user by telegram_chat_id = '0980682889'
    user = User.query.filter_by(telegram_chat_id='0980682889').first()
    
    if not user:
        # Check if testuser exists and update its chat_id to match the bot's user
        user = User.query.filter_by(username="testuser").first()
        if user:
            user.telegram_chat_id = '0980682889'
            user.balance = 202.0
            db.session.commit()
        else:
            # Create the specific user if nothing matches
            user = User()
            user.username = "testuser"
            user.balance = 202.0
            user.telegram_chat_id = "0980682889"
            db.session.add(user)
            db.session.commit()
            
@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        username = request.form.get("username")
        telegram_chat_id = request.form.get("telegram_chat_id")
        referred_by = request.form.get("referred_by")
        
        if not username or not telegram_chat_id:
            return jsonify({"success": False, "message": "Username and Telegram Chat ID are required"}), 400
            
        # Check if user already exists (Telegram Chat ID must be unique)
        existing_user = User.query.filter_by(telegram_chat_id=telegram_chat_id).first()
        if existing_user:
            return jsonify({"success": False, "message": "Telegram Chat ID already registered"}), 400
            
        new_user = User()
        new_user.username = username
        new_user.telegram_chat_id = telegram_chat_id
        new_user.referred_by = referred_by
        new_user.balance = 0.0
        db.session.add(new_user)
        try:
            db.session.commit()
            # Send OTP logic would go here
            return jsonify({"success": True, "message": "Registration successful. OTP sent to your Telegram."})
        except Exception as e:
            db.session.rollback()
            return jsonify({"success": False, "message": str(e)}), 500
            
    return render_template("signup.html")

@app.route("/buy-card/<int:room_id>", methods=["POST"])
def buy_card(room_id):
    # Find the specific user for the purchase
    user = User.query.filter_by(telegram_chat_id='0980682889').first()
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    room = Room.query.get_or_404(room_id)
    
    if user.balance >= room.card_price:
        user.balance -= room.card_price
        transaction = Transaction()
        transaction.user_id = user.id
        transaction.room_id = room.id
        transaction.amount = room.card_price
        db.session.add(transaction)
        db.session.commit()
        
        # Count players in this room based on recent transactions
        player_count = db.session.query(db.func.count(db.distinct(Transaction.user_id))).filter(Transaction.room_id == room.id).scalar()
        
        # Calculate prize (ደራሽ) - Total bet amount minus house cut (e.g., 20% cut)
        house_cut = 0.2
        total_bets = player_count * room.card_price
        prize_amount = total_bets * (1 - house_cut)
        
        return jsonify({
            "success": True, 
            "new_balance": user.balance, 
            "message": f"Purchased card for {room.name} at {room.card_price}",
            "players": player_count,
            "prize": round(prize_amount, 2),
            "bet": room.card_price
        })
    
    return jsonify({"success": False, "message": "Insufficient balance"}), 400

@app.route("/setup-rooms")
def setup_rooms():
    if not Room.query.first():
        room1 = Room()
        room1.name = "5 ETB Room"
        room1.card_price = 5.0
        
        room2 = Room()
        room2.name = "10 ETB Room"
        room2.card_price = 10.0
        
        room3 = Room()
        room3.name = "20 ETB Room"
        room3.card_price = 20.0
        
        room4 = Room()
        room4.name = "50 ETB Room"
        room4.card_price = 50.0
        
        room5 = Room()
        room5.name = "100 ETB Room"
        room5.card_price = 100.0
        
        db.session.add_all([room1, room2, room3, room4, room5])
        db.session.commit()
    return "Rooms setup completed! Rooms created: 5, 10, 20, 50, 100 ETB."
