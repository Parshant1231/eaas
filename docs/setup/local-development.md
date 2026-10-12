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
