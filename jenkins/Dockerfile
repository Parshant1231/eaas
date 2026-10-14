FROM jenkins/jenkins:lts-jdk21

USER root

ARG TERRAFORM_VERSION
ARG AWSCLI_VERSION
ARG KUBECTL_VERSION
ARG HELM_VERSION

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv openssh-client jq unzip curl ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Terraform (checksum verified)
RUN set -eux; cd /tmp; \
    curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip"; \
    curl -fsSLO "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_SHA256SUMS"; \
    grep "terraform_${TERRAFORM_VERSION}_linux_amd64.zip" "terraform_${TERRAFORM_VERSION}_SHA256SUMS" | sha256sum -c -; \
    unzip -q "terraform_${TERRAFORM_VERSION}_linux_amd64.zip" -d /usr/local/bin; \
    rm -f /tmp/terraform_*

# AWS CLI v2
RUN set -eux; cd /tmp; \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip" -o awscliv2.zip; \
    unzip -q awscliv2.zip; ./aws/install; \
    rm -rf aws awscliv2.zip

# kubectl (checksum verified)
RUN set -eux; cd /tmp; \
    curl -fsSLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"; \
    curl -fsSLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256"; \
    echo "$(cat kubectl.sha256)  kubectl" | sha256sum -c -; \
    install -m 0755 kubectl /usr/local/bin/kubectl; \
    rm -f kubectl kubectl.sha256

# Helm (checksum verified)
RUN set -eux; cd /tmp; \
    curl -fsSLO "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz"; \
    curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz.sha256sum" -o helm.sha256sum; \
    sha256sum -c helm.sha256sum; \
    tar -xzf "helm-${HELM_VERSION}-linux-amd64.tar.gz"; \
    install -m 0755 linux-amd64/helm /usr/local/bin/helm; \
    rm -rf linux-amd64 helm-*.tar.gz helm.sha256sum

# Ansible + boto3 in a venv, pinned by ansible/requirements.txt
COPY ansible/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/ansible-venv \
 && /opt/ansible-venv/bin/pip install --no-cache-dir --retries 10 --timeout 60 -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt
ENV PATH="/opt/ansible-venv/bin:${PATH}"

USER jenkins

COPY --chown=jenkins:jenkins jenkins/plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
