/**
 * Centralized error handling utilities
 */

import { toast } from 'vue-sonner';

export interface ErrorContext {
  operation: string;
  provider?: string;
  details?: Record<string, unknown>;
}

/**
 * Logs an error with context and optionally shows a user-friendly toast
 */
export function handleError(
  error: unknown,
  context: ErrorContext,
  showToast: boolean = true
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(`[${context.operation}] Error:`, {
    message: errorMessage,
    stack: errorStack,
    provider: context.provider,
    ...context.details,
  });

  if (showToast) {
    const providerText = context.provider ? ` (${context.provider})` : '';
    toast.error(`${context.operation} failed${providerText}`, {
      description: errorMessage,
    });
  }
}

/**
 * Handles provider-specific errors with appropriate messaging
 */
export function handleProviderError(
  error: unknown,
  provider: string,
  operation: string
): void {
  handleError(error, {
    operation,
    provider,
  });
}

/**
 * Handles API errors with retry information
 */
export function handleApiError(
  error: unknown,
  apiName: string,
  retryAfter?: number
): void {
  const context: ErrorContext = {
    operation: `${apiName} API call`,
    details: retryAfter ? { retryAfter } : undefined,
  };

  handleError(error, context);

  if (retryAfter) {
    toast.warning(`Rate limited. Try again in ${retryAfter} seconds.`);
  }
}

/**
 * Handles authentication errors
 */
export function handleAuthError(provider: string): void {
  toast.error(`${provider} authentication required`, {
    description: `Please authenticate ${provider} in the extension settings.`,
  });
}

/**
 * Wraps an async function with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: ErrorContext
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, context);
      throw error; // Re-throw to allow caller to handle if needed
    }
  }) as T;
}
