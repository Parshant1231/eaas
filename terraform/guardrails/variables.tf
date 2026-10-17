variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "alert_email" {
  type        = string
  description = "Where budget and reaper alarms are sent"

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must look like an email address."
  }
}

variable "monthly_budget_usd" {
  type    = number
  default = 10
}

variable "grace_minutes" {
  type        = number
  default     = 30
  description = "How long after expiry before instances are terminated directly"

  validation {
    condition     = var.grace_minutes >= 5 && var.grace_minutes <= 240
    error_message = "grace_minutes must be between 5 and 240."
  }
}

variable "reaper_dry_run" {
  type        = bool
  default     = true
  description = "When true the reaper only logs what it would do. Set to false after reading the logs."
}
