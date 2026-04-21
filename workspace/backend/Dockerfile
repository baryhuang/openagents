FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Production uses Browserbase (cloud) via BROWSERBASE_API_KEY — no local
# Chromium is needed in the runtime image. The Playwright Python SDK is
# still installed (from requirements.txt) so `from playwright.async_api
# import async_playwright` works; only the ~620MB browser binaries are
# skipped. For local-browser dev mode, run `playwright install chromium`
# outside the container or in a dev-specific image.

# Copy application code
COPY . .

RUN chmod +x entrypoint.sh

ENV PYTHONPATH=/app

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
