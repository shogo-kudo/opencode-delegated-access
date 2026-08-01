import type { createOpencodeClient } from "@opencode-ai/sdk"
import { sendNotification } from "../notify/notify.ts"
import type { DelegatedAccessConfig } from "../config.ts"
import type { Logger } from "../log.ts"

type OpencodeClient = ReturnType<typeof createOpencodeClient>

/** Upper bound on the command string we embed in the notification body. */
const COMMAND_DISPLAY_MAX = 180

/** Button labels used for the RISKY notification. */
const APPROVE_LABEL = "Approve"
const REJECT_LABEL = "Reject"

/**
 * Show a RISKY warning in OpenCode while leaving its permission prompt active.
 * The `all` policy also enables the legacy interactive macOS notification.
 * Any UI or SDK failure leaves the prompt available for a human decision.
 */
export async function runRiskyPathInBackground(args: {
  client: OpencodeClient
  sessionID: string
  permissionID: string
  command: string
  reason: string
  sound: boolean
  timeoutSec: number
  macosNotificationPolicy: DelegatedAccessConfig["macosNotificationPolicy"]
  log: Logger
}): Promise<void> {
  const {
    client,
    sessionID,
    permissionID,
    command,
    reason,
    sound,
    timeoutSec,
    macosNotificationPolicy,
    log,
  } = args

  const displayCmd =
    command.length > COMMAND_DISPLAY_MAX
      ? command.slice(0, COMMAND_DISPLAY_MAX) + "…"
      : command

  const displayReason = reason.length > 0 ? ` (${reason})` : ""

  try {
    await client.tui.showToast({
      body: {
        title: "delegated-access: RISKY command",
        message: `${displayCmd}${displayReason}`,
        variant: "warning",
        duration: timeoutSec * 1000,
      },
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log.warn("failed to show TUI toast for risky command", {
      permissionID,
      sessionID,
      error,
    })
  }

  if (macosNotificationPolicy !== "all") {
    return
  }

  const result = await sendNotification({
    title: "delegated-access: review risky command",
    message: `${displayCmd}${displayReason}`,
    actions: [APPROVE_LABEL, REJECT_LABEL],
    sound,
    timeoutSec,
  })

  if (result.type !== "action") return

  let response: "once" | "reject" | undefined
  if (result.label === APPROVE_LABEL) response = "once"
  else if (result.label === REJECT_LABEL) response = "reject"
  if (!response) return

  try {
    // Resolve the permission programmatically; this closes the TUI prompt.
    await (
      client as unknown as {
        postSessionIdPermissionsPermissionId: (opts: {
          path: { id: string; permissionID: string }
          body: { response: "once" | "always" | "reject" }
        }) => Promise<unknown>
      }
    ).postSessionIdPermissionsPermissionId({
      path: { id: sessionID, permissionID },
      body: { response },
    })
  } catch {
    // Swallow — TUI prompt is still live as a fallback.
  }
}
