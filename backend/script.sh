#/bin/bash

apt update

apt install redis-server wget systemctl -y

systemctl enable --now redis-server