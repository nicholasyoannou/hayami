/**
 * Centralized error handling utilities
 */

import { toast } from 'vue-sonner';
import { con } from '@/utils/logger';
const log = con.m('ErrorHandler');

interface ErrorContext {
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

  log.error(`${context.operation} Error:`, {
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

