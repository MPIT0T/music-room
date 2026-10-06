#/bin/bash

apt update

apt install redis-server wget systemctl -y

npm install ioredis

systemctl enable --now redis-server