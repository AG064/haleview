export type NutritionGenerationErrorCode =
  | "not_configured"
  | "provider_rejected"
  | "rate_limited"
  | "timed_out"
  | "network_error"
  | "malformed_response"
  | "unknown_function"
  | "invalid_parameters"
  | "missing_ingredient"
  | "calculation_failed";

export class NutritionGenerationError extends Error {
  constructor(
    public readonly code: NutritionGenerationErrorCode,
    message: string,
    public readonly status: number,
    public readonly recoverable: boolean,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "NutritionGenerationError";
  }
}
