output "env_id" {
  value = var.env_id
}

output "expires_at" {
  value = var.expires_at
}

output "public_ips" {
  value = module.compute.public_ips
}

output "first_public_ip" {
  value = module.compute.public_ips[0]
}

output "private_ips" {
  value = module.compute.private_ips
}
