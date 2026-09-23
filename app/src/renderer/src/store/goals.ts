import type { CreateGoalInput, Goal, UpdateGoalInput } from '@shared/types'
import { bridge } from '@/lib/bridge'
import { useVaultQuery, type VaultQuery } from './useVaultQuery'
import { invalidateVault } from './vault'

export function useGoals(): VaultQuery<Goal[]> {
  return useVaultQuery(() => bridge().goals.list(), [])
}

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const goal = await bridge().goals.create(input)
  invalidateVault()
  return goal
}

export async function updateGoal(id: string, updates: UpdateGoalInput): Promise<Goal> {
  const goal = await bridge().goals.update(id, updates)
  invalidateVault()
  return goal
}

export async function removeGoal(id: string): Promise<void> {
  await bridge().goals.remove(id)
  invalidateVault()
}
