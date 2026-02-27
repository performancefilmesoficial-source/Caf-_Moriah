FROM node:18-alpine

WORKDIR /app

# Copiar dependências
COPY package*.json ./
RUN npm install

# Copiar código-fonte
COPY . .

# Garantir que a pasta de uploads existe com permissões
RUN mkdir -p /app/uploads && chmod 755 /app/uploads

# Declarar volume persistente para imagens (mantém entre deploys)
VOLUME ["/app/uploads"]

# Expor porta 3000
EXPOSE 3000

# Iniciar servidor
CMD ["npm", "start"]
