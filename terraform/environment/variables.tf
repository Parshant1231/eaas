variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "env_id" {
  type        = string
  description = "Unique environment id, used in names and the state key"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.env_id))
    error_message = "env_id must be 3-20 chars: lowercase letters, digits, hyphens; start with a letter."
  }
}

variable "owner" {
  type = string
}

variable "size" {
  type = string

  validation {
    condition     = contains(["small", "medium"], var.size)
    error_message = "size must be small or medium."
  }
}

variable "ttl_hours" {
  type = number

  validation {
    condition     = contains([1, 2, 4], var.ttl_hours)
    error_message = "ttl_hours must be 1, 2 or 4. A TTL is mandatory."
  }
}

variable "expires_at" {
  type        = string
  description = "UTC expiry like 2026-10-11T18:30:00Z, computed by the caller"

  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.expires_at))
    error_message = "expires_at must look like 2026-10-11T18:30:00Z."
  }
}

variable "cost_center" {
  type    = string
  default = "eaas-portfolio"
}

variable "operator_cidr" {
  type = string
}

variable "public_key" {
  type = string
}
