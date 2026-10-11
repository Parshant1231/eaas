variable "env_id" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}

variable "allowed_ssh_cidr" {
  type        = string
  description = "CIDR allowed to SSH to the nodes (your public IP as x.x.x.x/32)"

  validation {
    condition     = can(cidrhost(var.allowed_ssh_cidr, 0)) && var.allowed_ssh_cidr != "0.0.0.0/0"
    error_message = "Provide a valid CIDR and never 0.0.0.0/0 for SSH."
  }
}
