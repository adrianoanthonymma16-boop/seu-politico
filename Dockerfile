FROM node:22-alpine

WORKDIR /app

# Dependências primeiro (aproveita cache de camadas)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Código do projeto
COPY . .

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "server.js"]
