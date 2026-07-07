import { AsyncLocalStorage } from 'node:async_hooks'

const userContext = new AsyncLocalStorage<string>()

export function setRequestUserId(userId: string): void {
  userContext.enterWith(userId)
}

export function getCurrentUserId(): string | undefined {
  return userContext.getStore()
}

export function runWithUserId<T>(userId: string, fn: () => T): T {
  return userContext.run(userId, fn)
}
