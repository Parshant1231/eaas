# Local development setup

## Prerequisites
- Docker with the Compose plugin (Jenkins)
- AWS CLI v2 configured with a non-root IAM user, region ap-south-1
- Terraform >= 1.11
- Python 3 venv for Ansible

## Ansible
python3 -m venv ~/.venvs/eaas
source ~/.venvs/eaas/bin/activate
pip install -r ansible/requirements.txt

## Run against an environment
./scripts/render-inventory.sh <env-id>
cd ansible
ansible-playbook -i inventory/generated/<env-id>.aws_ec2.yml playbooks/site.yml

Always pass -i explicitly; there is no default inventory on purpose.

## Jenkins
./scripts/build-jenkins-image.sh   # builds the image with the pinned toolchain and starts Jenkins
Then add the three credentials (eaas-aws-access-key-id, eaas-aws-secret-access-key,
eaas-ssh-key) and create the eaas-create and eaas-destroy pipeline jobs.
Never run docker compose down -v (it deletes the Jenkins data volume).

## Portal
Requires Node >= 20.6. Create the read-only IAM user (terraform/pipeline-iam), an AWS CLI
profile named eaas-portal, and a Jenkins API token; put them in portal/.env (never commit it).
Run with npm run dev inside portal/.
