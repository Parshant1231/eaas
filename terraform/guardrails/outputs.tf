output "queue_url" {
  value = aws_sqs_queue.destroy_requests.url
}

output "reaper_function" {
  value = aws_lambda_function.reaper.function_name
}
