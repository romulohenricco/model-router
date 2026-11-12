export class RouterError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RouterError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = Boolean(options.retryable);
  }
}

export function publicError(error) {
  const result = {
    code: error?.code ?? error?.name ?? "UNKNOWN_ERROR",
    http_status: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    retryable: Boolean(error?.retryable)
  };
  if (!(error instanceof RouterError) && error?.message) result.message = String(error.message).slice(0, 300);
  if (error?.executionId) result.execution_id = error.executionId;
  if (Array.isArray(error?.attempts)) result.attempts = error.attempts;
  if (error?.telemetryStatus) result.telemetry_status = error.telemetryStatus;
  return result;
}
