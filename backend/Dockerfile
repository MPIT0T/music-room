# syntax=docker/dockerfile:1
FROM node:22-slim AS base
WORKDIR /app

COPY . .
RUN chmod +x ./script.sh
RUN ./script.sh

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS prod
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]