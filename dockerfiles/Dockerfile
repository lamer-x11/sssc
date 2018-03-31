FROM mhart/alpine-node:10

RUN apk update

RUN adduser -D -u 1000 dev

RUN apk add --no-cache curl make sudo 
RUN echo "dev ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

WORKDIR /app
RUN chown dev:dev /app

ENV HOME /home/dev
USER dev

CMD /usr/bin/node sssc.js
