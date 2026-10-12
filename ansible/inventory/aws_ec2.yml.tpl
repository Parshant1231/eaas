plugin: amazon.aws.aws_ec2
regions:
  - ap-south-1
filters:
  tag:project: eaas
  tag:env-id: "__ENV_ID__"
  instance-state-name: running
hostnames:
  - ip-address
keyed_groups:
  - key: ec2_tags.role
    prefix: role
compose:
  ansible_host: public_ip_address
