FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 AS adapter
FROM node:20-slim

# Copy Lambda Web Adapter
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Set default port
ENV PORT=3000

# Start Express server via Lambda Web Adapter
CMD ["npm", "start"]
