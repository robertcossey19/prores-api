FROM node:20-bookworm
RUN apt-get update && apt-get install -y ffmpeg
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["node","server.js"]
