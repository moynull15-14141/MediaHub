FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 ffmpeg \
    && pip install --no-cache-dir --break-system-packages --upgrade yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm install --include=dev --no-audit --progress=false --ignore-scripts \
    && npm rebuild 2>/dev/null || echo "youtube-dl-exec binary download skipped (yt-dlp available from system)"

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
