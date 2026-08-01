import { describe, it, expect } from "vitest"

import {
  CLASSIFIER_SYSTEM_PROMPT,
  DIRECTORY_CLASSIFIER_SYSTEM_PROMPT,
} from "./prompt.ts"

describe("CLASSIFIER_SYSTEM_PROMPT", () => {
  const testCases = [
    { name: "command", prompt: CLASSIFIER_SYSTEM_PROMPT },
    { name: "directory", prompt: DIRECTORY_CLASSIFIER_SYSTEM_PROMPT },
  ] as const

  it.each(testCases)(
    "Given $name prompt, When extracting risky_reason_language, Then value should be ja",
    ({ prompt }) => {
      const match = prompt.match(
        /<risky_reason_language>([\s\S]*?)<\/risky_reason_language>/,
      )
      const riskyReasonLanguage = match?.[1]?.trim() ?? ""

      expect(riskyReasonLanguage).toBe("ja")
    },
  )
})
