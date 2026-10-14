variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "state_bucket_name" {
  type        = string
  description = "Name of the Terraform state bucket (from terraform/backend)"
}
