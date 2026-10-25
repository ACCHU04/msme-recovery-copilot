# Settle45 backend (FastAPI). Small image, non-root user.
# WEB_CONCURRENCY = number of workers (default 2). Use 1 for demo mode (STORE=memory):
# each worker would otherwise keep its own copy of the in-memory demo data.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8080
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY recovery_engine ./recovery_engine
COPY copilot ./copilot

RUN useradd --create-home settle45
USER settle45

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8080\")}/api/health', timeout=4)"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY:-2} --proxy-headers"]
