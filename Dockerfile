FROM node:18-alpine

WORKDIR /app

# Copiar dependências
COPY package*.json ./
RUN npm install

# Copiar código-fonte
COPY . .

# Expor porta 3000
EXPOSE 3000

# Iniciar servidor
CMD ["npm", "start"]
