FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm install --no-save tsx
COPY src ./src
COPY tsconfig.json ./
CMD ["npx", "tsx", "src/index.ts"]
