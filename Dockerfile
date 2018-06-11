from node:alpine

RUN npm install truffle -g

COPY ./package.json ./

# install git
RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

# adding python (some npm modules need it)
RUN apk --no-cache add g++ gcc libgcc libstdc++ linux-headers make python
RUN npm install --quiet node-gyp -g

# install node modules
RUN npm install

COPY . .

CMD ["./wait_and_run.sh"]