FROM node:20-slim

WORKDIR /app

# Install OpenSSL (required by Prisma) and other essentials
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm install

# Generate Prisma client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source
COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
