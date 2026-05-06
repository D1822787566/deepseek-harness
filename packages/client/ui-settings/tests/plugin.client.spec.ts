import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'
import { ConfigForms } from '../src/client/config-form.ts'

function bench(isLoopback = true, allowRemoteSettings = false) {
  const describeCall = vi.fn().mockResolvedValue({
    ok: true, value: { writable: true, hasDocument: true, namespaces: [] },
  })
  const ctx = new Context()
  const remote = new TestRemote(ctx, { settings: { describe: describeCall } })
  remote.$host.isLoopback = isLoopback
  vi.stubGlobal('__DSH_REMOTE_SETTINGS__', allowRemoteSettings)
  onTestFinished(() => { vi.unstubAllGlobals() })
  onTestFinished(() => ctx.fiber.dispose())
  return { ctx, describeCall, remote, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('keeps remote settings unavailable without the deployment opt-in', async () => {
    const { ctx, describeCall, fiber } = bench(false)
    await fiber.await()
    await ctx.configForms.describe().ensure()
    expect(ctx.configForms.describe().getSnapshot().status).toBe('unavailable')
    expect(describeCall).not.toHaveBeenCalled()
  })

  it('loads Host settings for an opted-in remote browser without changing its loopback identity', async () => {
    const { ctx, describeCall, remote, fiber } = bench(false, true)
    await fiber.await()
    await ctx.configForms.describe().ensure()
    expect(ctx.configForms.describe().getSnapshot().status).toBe('ready')
    expect(describeCall).toHaveBeenCalledTimes(1)
    expect(remote.$host.isLoopback).toBe(false)
  })
  it('mounts the scope service under configForms and reads once eagerly', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    expect(ctx.get('configForms')).toBeInstanceOf(ConfigForms)
    expect(ctx.get('settingsSchema')).toBeInstanceOf(SettingsSchemaService)
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
  })

  it('refreshes the mirror on document commits and connection resets, once each', async () => {
    const { ctx, describeCall, remote, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    remote.emit('settings/document-updated', ['ui-test', 0])
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(2) })
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
  })

  it('fiber disposal retires the service and its invalidation subscriptions', async () => {
    const { ctx, describeCall, remote, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    await fiber.dispose()
    expect(ctx.get('configForms')).toBeUndefined()
    expect(ctx.get('settingsSchema')).toBeUndefined()
    remote.emit('settings/document-updated', ['ui-test', 0])
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
  })
})
