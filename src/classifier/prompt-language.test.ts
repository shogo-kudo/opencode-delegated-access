import { describe, it, expect } from "vitest"

import { CLASSIFIER_SYSTEM_PROMPT } from "./prompt.ts"

describe("CLASSIFIER_SYSTEM_PROMPT", () => {
  it("Given a classifier prompt, When extracting risky_reason_language, Then value should be ja", () => {
    const match = CLASSIFIER_SYSTEM_PROMPT.match(
      /<risky_reason_language>([\s\S]*?)<\/risky_reason_language>/,
    )
    const riskyReasonLanguage = match?.[1]?.trim() ?? ""

    expect(riskyReasonLanguage).toBe("ja")
  })
})
