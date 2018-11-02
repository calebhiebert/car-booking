FROM node:8-alpine

WORKDIR /usr/src/app

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

COPY package.json yarn.lock ./
RUN yarn && yarn cache clean
COPY . .

CMD ["yarn", "start"]