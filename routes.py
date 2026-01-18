from flask import render_template, request, jsonify, redirect, url_for
from app import app, db
from models import User, Room, Transaction

@app.route("/")
def index():
    rooms = Room.query.all()
    # For demo purposes, we'll use a hardcoded user_id=1
    user = User.query.get(1)
    if not user:
        # Create a default user if not exists for testing
        user = User(username="testuser", balance=1000.0)
        db.session.add(user)
        db.session.commit()
    return render_template("index.html", rooms=rooms, balance=user.balance)

@app.route("/buy-card/<int:room_id>", methods=["POST"])
def buy_card(room_id):
    # For demo purposes, we'll use a hardcoded user_id=1
    user = User.query.get(1)
    if not user:
        # Create a default user if not exists for testing
        user = User(username="testuser", balance=1000.0)
        db.session.add(user)
        db.session.commit()
    
    room = Room.query.get_or_404(room_id)
    
    if user.balance >= room.card_price:
        user.balance -= room.card_price
        transaction = Transaction(user_id=user.id, room_id=room.id, amount=room.card_price)
        db.session.add(transaction)
        db.session.commit()
        return jsonify({"success": True, "new_balance": user.balance, "message": f"Purchased card for {room.name} at {room.card_price}"})
    
    return jsonify({"success": False, "message": "Insufficient balance"}), 400

@app.route("/setup-rooms")
def setup_rooms():
    if not Room.query.first():
        room1 = Room(name="5 ETB Room", card_price=5.0)
        room2 = Room(name="10 ETB Room", card_price=10.0)
        room3 = Room(name="20 ETB Room", card_price=20.0)
        room4 = Room(name="50 ETB Room", card_price=50.0)
        room5 = Room(name="100 ETB Room", card_price=100.0)
        db.session.add_all([room1, room2, room3, room4, room5])
        db.session.commit()
    return "Rooms setup completed! Rooms created: 5, 10, 20, 50, 100 ETB."
