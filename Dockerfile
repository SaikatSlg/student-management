# Use an official Node.js runtime as base
FROM node:18

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose the port Cloud Run will use
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
