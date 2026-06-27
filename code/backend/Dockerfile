# Live-run backend: real CrewAI execution. Hosts that run containers (Render,
# Railway, Fly.io) build this and run the FastAPI server on $PORT.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# install deps first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# $PORT is provided by the host (default 8000 for local docker run)
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
