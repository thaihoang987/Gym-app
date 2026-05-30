FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# Download exercise dataset from GitHub (only if not already present in build context)
FROM node:22-alpine AS dataset
RUN apk add --no-cache git
WORKDIR /app
RUN git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset.git hasaneyldrm-exercises-dataset \
    && rm -rf hasaneyldrm-exercises-dataset/.git \
    && rm -rf hasaneyldrm-exercises-dataset/videos

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=dataset /app/hasaneyldrm-exercises-dataset ./hasaneyldrm-exercises-dataset

RUN mkdir -p /app/data /app/uploads
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "server/index.js"]
