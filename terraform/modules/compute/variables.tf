variable "env_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "instance_type" {
  type = string

  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type)
    error_message = "Cost guard: only t3.micro, t3.small or t3.medium are allowed."
  }
}

variable "node_count" {
  type = number

  validation {
    condition     = var.node_count >= 1 && var.node_count <= 2
    error_message = "node_count must be 1 or 2."
  }
}

variable "public_key" {
  type        = string
  description = "SSH public key (safe to commit, never the private key)"
}

variable "root_volume_gb" {
  type    = number
  default = 20
}
