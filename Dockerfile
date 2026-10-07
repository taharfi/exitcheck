FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV ACTION_DB_PATH=/app/data/actions.sqlite
ENV SHADOW_DB_PATH=/app/data/shadow.sqlite
ENV SHADOW_COLLECTOR_ENABLED=true
ENV MARKET_RECORDER_ENABLED=true
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
