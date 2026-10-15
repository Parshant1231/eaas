/** An upstream dependency (Jenkins or AWS) failed. Messages are safe to show to the user. */
export class UpstreamError extends Error {
  constructor(message: string, readonly status: number = 502) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class JenkinsError extends UpstreamError {
  constructor(message: string, status: number = 502) {
    super(message, status);
    this.name = 'JenkinsError';
  }
}
