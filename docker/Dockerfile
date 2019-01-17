FROM node:11.6.0-alpine

# Needed to fix permissions issue when deploying to hive
RUN npm config set unsafe-perm true && \
    npm install truffle@5.0.0 -g && \
    npm install npm@6.6.0-next.1 -g

COPY package.json package-lock.json ./

# install git
RUN apk update && apk upgrade && \
    apk add --no-cache bash git curl openssh

# adding python (some npm modules need it)
RUN apk --no-cache add g++ gcc libgcc libstdc++ linux-headers make python
RUN npm install --quiet node-gyp -g
# install node modules
RUN npm install

COPY . .

CMD ["./scripts/test_with_ganache.sh"]
