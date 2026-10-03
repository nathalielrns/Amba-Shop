# Vercel entrypoint for the existing FastAPI application.
# The actual application remains in app/main.py.
from app.main import app

__all__ = ["app"]
