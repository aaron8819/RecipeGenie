"use client"

/**
 * Shopping hooks - backward compatibility barrel export
 *
 * This file re-exports all shopping hooks from the modular shopping/ directory.
 * Existing imports from "@/hooks/use-shopping" will continue to work.
 *
 * For new code, you can import directly from "@/hooks/shopping" or specific modules:
 * - "@/hooks/shopping/use-shopping-list" for core list operations
 * - "@/hooks/shopping/use-shopping-items" for item operations
 * - "@/hooks/shopping/use-shopping-recipes" for recipe operations
 * - "@/hooks/shopping/use-shopping-categories" for category operations
 * - "@/hooks/shopping/use-shopping-config" for config operations
 * - "@/hooks/shopping/use-shopping-pantry" for pantry integration
 */

export * from "./shopping"
