FROM python:3.13-slim

WORKDIR /app

# PyQt5 is imported by the current application module even in web-only mode.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libegl1 libgl1 libglib2.0-0 libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN iconv -f GBK -t UTF-8 requirements.txt > requirements.utf8.txt \
    && pip install --no-cache-dir -r requirements.utf8.txt

EXPOSE 5001

CMD ["python", "main.py", "run"]
