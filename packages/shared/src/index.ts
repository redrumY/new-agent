/**
 * Z-Agent Shared Package
 *
 * This package contains all shared types, constants, and utilities
 * used across the Z-Agent monorepo.
 */

// Export all types
export * from "./types";

// Export constants
export const AGENT_VERSION = "1.0.0";

export const DEFAULT_MAX_ITERATIONS = 10;

export const DEFAULT_MODEL = "claude-3-5-sonnet-20241022" as const;
