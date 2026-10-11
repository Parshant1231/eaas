locals {
  sizes = {
    small  = { instance_type = "t3.small", node_count = 1 }
    medium = { instance_type = "t3.medium", node_count = 2 }
  }
  size_cfg = local.sizes[var.size]
}

module "network" {
  source           = "../modules/network"
  env_id           = var.env_id
  allowed_ssh_cidr = var.allowed_ssh_cidr
}

module "compute" {
  source            = "../modules/compute"
  env_id            = var.env_id
  subnet_id         = module.network.subnet_id
  security_group_id = module.network.security_group_id
  instance_type     = local.size_cfg.instance_type
  node_count        = local.size_cfg.node_count
  public_key        = var.public_key
}
