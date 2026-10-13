data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.env_id}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.env_id}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "${var.env_id}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.env_id}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "nodes" {
  name        = "${var.env_id}-nodes"
  description = "EaaS nodes"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.env_id}-nodes-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
  description       = "SSH from operator IP only"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound for package installs and image pulls"
}

resource "aws_vpc_security_group_ingress_rule" "intra_cluster" {
  security_group_id            = aws_security_group.nodes.id
  referenced_security_group_id = aws_security_group.nodes.id
  ip_protocol                  = "-1"
  description                  = "Node-to-node traffic (k3s, kubelet, flannel, node_exporter)"
}

resource "aws_vpc_security_group_ingress_rule" "k8s_api" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 6443
  to_port           = 6443
  ip_protocol       = "tcp"
  description       = "kubectl and helm from operator IP only"
}

resource "aws_vpc_security_group_ingress_rule" "app_nodeport" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 30080
  to_port           = 30080
  ip_protocol       = "tcp"
  description       = "Sample app (NodePort) from operator IP only"
}

resource "aws_vpc_security_group_ingress_rule" "grafana_nodeport" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 30300
  to_port           = 30300
  ip_protocol       = "tcp"
  description       = "Grafana (NodePort) from operator IP only"
}

resource "aws_vpc_security_group_ingress_rule" "k8s_api" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 6443
  to_port           = 6443
  ip_protocol       = "tcp"
  description       = "kubectl and helm from operator IP only"
}

resource "aws_vpc_security_group_ingress_rule" "app_nodeport" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 30080
  to_port           = 30080
  ip_protocol       = "tcp"
  description       = "Sample app (NodePort) from operator IP only"
}

resource "aws_vpc_security_group_ingress_rule" "grafana_nodeport" {
  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = var.operator_cidr
  from_port         = 30300
  to_port           = 30300
  ip_protocol       = "tcp"
  description       = "Grafana (NodePort) from operator IP only"
}
