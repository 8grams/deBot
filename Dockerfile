FROM node:18.20.7-bookworm-slim as base

RUN apt-get update && apt-get install -y sudo curl git python3 make g++ libkrb5-dev libssl-dev && \
	ln -s $(which python3) /usr/local/bin/python

WORKDIR /opt/app

# install kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
RUN chmod +x kubectl
RUN mv kubectl /usr/local/bin/kubectl

# install argocd
RUN curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/download/v2.13.2/argocd-linux-amd64
RUN install -m 555 argocd-linux-amd64 /usr/local/bin/argocd
RUN rm argocd-linux-amd64

FROM base as runner

COPY package.json package-lock.json /opt/app/

RUN npm install

COPY . .
RUN chmod +x start.sh

ENTRYPOINT ["./start.sh"]