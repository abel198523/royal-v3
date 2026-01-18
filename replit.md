# Flask Website Project

## Overview
This is a Flask web application migrated to the Replit environment. It is designed to be compatible with Render for final deployment.

## Deployment on Render
To deploy this application on Render:
1. **Build Command**: `pip install -r requirements.txt` (if applicable) or ensure dependencies are managed.
2. **Start Command**: `gunicorn main:app`
3. **Environment Variables**:
   - `DATABASE_URL`: Your PostgreSQL connection string.
   - `SESSION_SECRET`: A secure random string for session encryption.
   - `PYTHON_VERSION`: 3.11.x

## Recent Changes
- Migrated project from Replit Agent to Replit.
- Configured PostgreSQL database.
- Added Render deployment considerations.
- Set up Gunicorn as the WSGI server.
