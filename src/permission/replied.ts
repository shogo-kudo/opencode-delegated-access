import type { ApprovalHistoryStore } from "./approval-history.ts"
import type { PendingSubjectsMap } from "./pending-subjects.ts"
import type { DelegatedAccessConfig } from "../config.ts"
import type { Logger } from "../log.ts"

/**
 * Normalise the `properties` payload of a `permission.replied` event
 * into the SDK-declared canonical shape `{ sessionID, permissionID,
 * response }`.
 *
 * Why this exists: opencode 1.4.x's SDK type declarations claim the
 * runtime emits `{ sessionID, permissionID, response }`, but the actual
 * runtime emits `{ sessionID, requestID, reply }` — same SDK/runtime
 * drift pattern we already handle for `permission.updated` permission
 * shapes (see `src/permission/handler.ts`'s `runtimeShape` adapter).
 * Without this normaliser, every TUI/notification approval was being
 * silently dropped with a `permission.replied: malformed event
 * properties` warning, and the entire approval-history capture path was
 * a no-op in production.
 *
 * Returns `null` for inputs that can't be coerced to the canonical
 * shape (missing sessionID, neither permissionID nor requestID, neither
 * response nor reply, or non-object input). The caller should treat
 * `null` as "malformed; log and skip."
 *
 * SDK keys win when both shapes are present, so that a future opencode
 * release switching to the canonical shape doesn't get mis-routed if it
 * also accidentally sets the legacy fields.
 */
export function normalizeRepliedProperties(
  raw: unknown,
): { sessionID: string; permissionID: string; response: string } | null {
  if (!raw || typeof raw !== "object") return null

  const r = raw as {
    sessionID?: unknown
    permissionID?: unknown
    response?: unknown
    requestID?: unknown
    reply?: unknown
  }

  if (typeof r.sessionID !== "string") return null

  const permissionID =
    typeof r.permissionID === "string"
      ? r.permissionID
      : typeof r.requestID === "string"
        ? r.requestID
        : null
  if (permissionID === null) return null

  const response =
    typeof r.response === "string"
      ? r.response
      : typeof r.reply === "string"
        ? r.reply
        : null
  if (response === null) return null

  return { sessionID: r.sessionID, permissionID, response }
}

/**
 * Pure handler for `permission.replied` events. Looks up the matching
 * pending subject (set by the permission.updated path), filters out our
 * own auto-approvals, and appends a human-decision entry to the
 * approval history.
 *
 * Exported so unit tests can exercise it without spinning up the full
 * plugin factory. The plugin's `event` hook delegates to this on
 * `event.type === "permission.replied"`.
 */
export function handlePermissionReplied(
  properties: {
    sessionID: string
    permissionID: string
    response: string
  },
  deps: {
    pendingSubjects: PendingSubjectsMap
    approvalHistory: ApprovalHistoryStore
    config: DelegatedAccessConfig
    log: Logger
    now?: () => number
  },
): void {
  const { pendingSubjects, approvalHistory, config, log } = deps
  const now = deps.now ?? Date.now

  if (!config.approvalHistoryEnabled) {
    log.debug("permission.replied: history disabled", {
      permissionID: properties.permissionID,
    })
    return
  }

  const pending = pendingSubjects.take(properties.permissionID)
  if (!pending) {
    log.debug("permission.replied: no pending subject for permissionID", {
      permissionID: properties.permissionID,
    })
    return
  }

  if (pending.autoApproved) {
    log.debug("permission.replied: skipping our own auto-approval", {
      permissionID: properties.permissionID,
      subject: pending.subject,
    })
    return
  }

  const response = properties.response
  if (response !== "once" && response !== "always" && response !== "reject") {
    log.warn("permission.replied: unrecognised response value", {
      permissionID: properties.permissionID,
      response,
    })
    return
  }

  if (pending.classifierVerdict === null) {
    // Human resolved before classifier returned — still record, but with
    // a clear marker that we have no classifier verdict to associate.
    log.info("permission.replied: human resolved before classifier", {
      permissionID: properties.permissionID,
      response,
    })
  }

  approvalHistory.record(pending.rootSessionID, {
    subject: pending.subject,
    subjectLabel: pending.subjectLabel,
    response,
    classifierVerdict: pending.classifierVerdict ?? "RISKY",
    classifierReason:
      pending.classifierReason ??
      "(classifier did not complete before human resolved)",
    timestamp: now(),
  })

  log.info("recorded human approval decision", {
    rootSessionID: pending.rootSessionID,
    permissionID: properties.permissionID,
    response,
    subject: pending.subject,
  })
}
