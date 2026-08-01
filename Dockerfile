FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 ffmpeg \
       ghostscript qpdf \
       fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-crosextra-carlito fonts-crosextra-caladea \
    && pip install --no-cache-dir --break-system-packages --upgrade yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm install --include=dev --no-audit --progress=false --ignore-scripts \
    && npm rebuild 2>/dev/null || echo "youtube-dl-exec binary download skipped (yt-dlp available from system)"

RUN npx prisma generate

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
