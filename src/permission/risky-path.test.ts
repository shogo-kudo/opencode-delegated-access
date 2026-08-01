import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../notify/notify.ts", () => ({
  sendNotification: vi.fn(),
}))

import { sendNotification } from "../notify/notify.ts"
import type { NotifyActionResult } from "../notify/notify.ts"
import { runRiskyPathInBackground } from "./risky-path.ts"

const mockedSend = vi.mocked(sendNotification)

beforeEach(() => {
  mockedSend.mockReset()
})

function makeMockClient(responseImpl?: (opts: unknown) => Promise<unknown>) {
  const call = vi.fn(
    responseImpl ?? (async () => ({ data: true } as unknown)),
  )
  const showToast = vi.fn(
    async (_opts?: {
      body: {
        title?: string
        message: string
        variant: string
        duration?: number
      }
    }) => {},
  )
  return {
    client: {
      postSessionIdPermissionsPermissionId: call,
      tui: {
        showToast,
      },
    } as never,
    call,
    showToast,
  }
}

const baseArgs: Omit<Parameters<typeof runRiskyPathInBackground>[0], "client"> = {
  sessionID: "sess_main",
  permissionID: "perm_123",
  command: "rm -rf build",
  reason: "destructive rm",
  sound: true,
  timeoutSec: 60,
  macosNotificationPolicy: "all",
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}

describe("runRiskyPathInBackground", () => {
  it("calls the SDK with response='once' when user clicks Approve", async () => {
    mockedSend.mockResolvedValueOnce({
      type: "action",
      label: "Approve",
    } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })

    expect(call).toHaveBeenCalledTimes(1)
    const arg = call.mock.calls[0]?.[0] as {
      path: { id: string; permissionID: string }
      body: { response: string }
    }
    expect(arg.path).toEqual({ id: "sess_main", permissionID: "perm_123" })
    expect(arg.body.response).toBe("once")
  })

  it("calls the SDK with response='reject' when user clicks Reject", async () => {
    mockedSend.mockResolvedValueOnce({
      type: "action",
      label: "Reject",
    } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })

    const arg = call.mock.calls[0]?.[0] as {
      body: { response: string }
    }
    expect(arg.body.response).toBe("reject")
  })

  it("does NOT call the SDK when the notification times out (user will decide in TUI)", async () => {
    mockedSend.mockResolvedValueOnce({ type: "timeout" } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })
    expect(call).not.toHaveBeenCalled()
  })

  it("does NOT call the SDK when the user dismisses the notification", async () => {
    mockedSend.mockResolvedValueOnce({ type: "cancel" } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })
    expect(call).not.toHaveBeenCalled()
  })

  it("does NOT call the SDK when the user clicks the notification body", async () => {
    mockedSend.mockResolvedValueOnce({ type: "click" } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })
    expect(call).not.toHaveBeenCalled()
  })

  it("does NOT call the SDK when the notifier errors (TUI is still available)", async () => {
    mockedSend.mockResolvedValueOnce({
      type: "error",
      error: new Error("no display"),
    } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })
    expect(call).not.toHaveBeenCalled()
  })

  it("does NOT throw if the SDK call itself errors (TUI is still there to fall back on)", async () => {
    mockedSend.mockResolvedValueOnce({
      type: "action",
      label: "Approve",
    } as NotifyActionResult)
    const { client } = makeMockClient(async () => {
      throw new Error("sdk boom")
    })

    await expect(
      runRiskyPathInBackground({ ...baseArgs, client }),
    ).resolves.toBeUndefined()
  })

  it("does NOT throw on unexpected action label — just leaves it for the TUI", async () => {
    mockedSend.mockResolvedValueOnce({
      type: "action",
      label: "Snooze",
    } as NotifyActionResult)
    const { client, call } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })
    // No SDK call for unknown actions; TUI prompt remains live.
    expect(call).not.toHaveBeenCalled()
  })

  it("passes Approve + Reject as action buttons, command + reason as context", async () => {
    mockedSend.mockResolvedValueOnce({ type: "timeout" } as NotifyActionResult)
    const { client } = makeMockClient()

    await runRiskyPathInBackground({ ...baseArgs, client })

    const args = mockedSend.mock.calls[0]?.[0]
    expect(args?.actions).toEqual(["Approve", "Reject"])
    expect(args?.message).toContain("rm -rf build")
    expect(args?.sound).toBe(true)
    expect(args?.timeoutSec).toBe(60)
    expect(args?.title.toLowerCase()).toMatch(/risky|review/)
  })

  it("truncates excessively long commands in the notification body", async () => {
    mockedSend.mockResolvedValueOnce({ type: "timeout" } as NotifyActionResult)
    const { client } = makeMockClient()

    const longCmd = "curl " + "x".repeat(500)
    await runRiskyPathInBackground({
      ...baseArgs,
      command: longCmd,
      client,
    })

    const args = mockedSend.mock.calls[0]?.[0]
    expect(args?.message.length).toBeLessThan(400)
  })

  describe("macosNotificationPolicy and TUI toast behavior", () => {
    it("shows a TUI warning toast and does NOT send macOS notification when policy is classifier-failure-only", async () => {
      // Given: macosNotificationPolicy is classifier-failure-only
      const { client, showToast } = makeMockClient()
      const args = {
        ...baseArgs,
        client,
        macosNotificationPolicy: "classifier-failure-only" as const,
      }

      // When: runRiskyPathInBackground is called for a RISKY command
      await runRiskyPathInBackground(args)

      // Then: client.tui.showToast is called with Japanese title/message and sendNotification is NOT called
      expect(showToast).toHaveBeenCalledTimes(1)
      const toastArg = showToast.mock.calls[0]?.[0]
      expect(toastArg?.body).toEqual({
        title: "危険な操作の確認",
        message: "rm -rf build (この操作には確認が必要です)",
        variant: "warning",
        duration: expect.any(Number),
      })
      expect(toastArg?.body.message).not.toContain("destructive rm")
      expect(mockedSend).not.toHaveBeenCalled()
    })

    it("uses the Japanese fallback message when reason is empty, while preserving directory path", async () => {
      // Given: reason is empty and command is a directory path deletion
      const { client, showToast } = makeMockClient()
      const args = {
        ...baseArgs,
        client,
        reason: "",
        command: "rm -rf /tmp/build",
        macosNotificationPolicy: "classifier-failure-only" as const,
      }

      // When: runRiskyPathInBackground is called for a RISKY command
      await runRiskyPathInBackground(args)

      // Then: the toast body keeps the directory path and uses the fallback reason in Japanese
      const toastArg = showToast.mock.calls[0]?.[0]
      expect(toastArg?.body).toEqual({
        title: "危険な操作の確認",
        message: "rm -rf /tmp/build (この操作には確認が必要です)",
        variant: "warning",
        duration: expect.any(Number),
      })
      expect(mockedSend).not.toHaveBeenCalled()
    })

    it("keeps a Japanese reason verbatim in the TUI toast message", async () => {
      // Given: reason is already Japanese and policy is classifier-failure-only
      const { client, showToast } = makeMockClient()
      const args = {
        ...baseArgs,
        client,
        reason: "このコマンドはビルド成果物を削除します",
        command: "rm -rf output-dir",
        macosNotificationPolicy: "classifier-failure-only" as const,
      }

      // When: runRiskyPathInBackground is called for a RISKY command
      await runRiskyPathInBackground(args)

      // Then: the toast body preserves the Japanese reason text verbatim
      const toastArg = showToast.mock.calls[0]?.[0]
      expect(toastArg?.body).toEqual({
        title: "危険な操作の確認",
        message: `rm -rf output-dir (このコマンドはビルド成果物を削除します)`,
        variant: "warning",
        duration: expect.any(Number),
      })
      expect(mockedSend).not.toHaveBeenCalled()
    })

    it("shows a TUI warning toast AND sends macOS notification when policy is all", async () => {
      // Given: macosNotificationPolicy is all
      mockedSend.mockResolvedValueOnce({ type: "timeout" } as NotifyActionResult)
      const { client, showToast } = makeMockClient()
      const args = {
        ...baseArgs,
        client,
        macosNotificationPolicy: "all" as const,
      }

      // When: runRiskyPathInBackground is called
      await runRiskyPathInBackground(args)

      // Then: client.tui.showToast AND sendNotification are both called
      expect(showToast).toHaveBeenCalledTimes(1)
      expect(showToast).toHaveBeenCalledWith({
        body: expect.objectContaining({
          title: "危険な操作の確認",
          message: "rm -rf build (この操作には確認が必要です)",
          variant: "warning",
          duration: expect.any(Number),
        }),
      })
      expect(mockedSend).toHaveBeenCalledTimes(1)
    })

    it("does NOT automatically respond or throw when client.tui.showToast fails", async () => {
      // Given: client.tui.showToast throws an error
      const { client, call, showToast } = makeMockClient()
      showToast.mockRejectedValueOnce(new Error("toast failed"))
      const args = {
        ...baseArgs,
        client,
        macosNotificationPolicy: "classifier-failure-only" as const,
      }

      // When: runRiskyPathInBackground is called
      await expect(runRiskyPathInBackground(args)).resolves.toBeUndefined()

      // Then: error is caught (does not throw), logged as warning, and permission is NOT auto-responded (maintains standard TUI approval)
      expect(args.log.warn).toHaveBeenCalledTimes(1)
      expect(args.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("toast"),
        expect.objectContaining({
          error: "toast failed",
        }),
      )
      expect(call).not.toHaveBeenCalled()
    })
  })
})
