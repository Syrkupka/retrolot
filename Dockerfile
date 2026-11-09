FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1
# seed only on the first start (empty volume), then run the server
CMD ["sh", "-c", "[ -f data/auction.db ] || node seed.js; node server.js"]
