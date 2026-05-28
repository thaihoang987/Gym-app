FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/hasaneyldrm-exercises-dataset ./hasaneyldrm-exercises-dataset
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "server/index.js"]
