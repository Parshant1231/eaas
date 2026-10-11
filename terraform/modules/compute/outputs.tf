output "instance_ids" {
  value = aws_instance.node[*].id
}

output "public_ips" {
  value = aws_instance.node[*].public_ip
}

output "private_ips" {
  value = aws_instance.node[*].private_ip
}
