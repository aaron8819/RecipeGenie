let activePrincipalId: string | null = null

export function setActivePrincipalId(userId: string | null): void {
  activePrincipalId = userId
}

export function getActivePrincipalId(): string | null {
  return activePrincipalId
}
