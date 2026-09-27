export const RESEARCH_REPORT_IMAGE_QUALITIES = ["auto", "high", "medium", "low"] as const

export type ResearchReportImageQuality = (typeof RESEARCH_REPORT_IMAGE_QUALITIES)[number]

export interface ResearchReportSummaryImageSettings {
  visualGuidance: string
  style: string
  model: string
  quality: ResearchReportImageQuality
  width: number
  height: number
}

export const DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS: ResearchReportSummaryImageSettings = {
  visualGuidance: "",
  style: "Premium institutional equity research summary. Landscape A4. Deep navy background, white typography, cyan accents, subtle amber for recommendation and green for positive evidence. Editorial grid, modern sans-serif, clear hierarchy, clean spacing, high readability, detailed report-relevant illustration, minimal decoration.",
  model: "gpt-image-2.5-sunburst",
  quality: "auto",
  width: 1754,
  height: 1240,
}

const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/

function boundedText(value: unknown, field: string, maxLength: number, fallback: string): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`)
  return normalized
}

function boundedInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 512 || numeric > 2048) {
    throw new Error(`${field} must be an integer from 512 to 2048`)
  }
  return numeric
}

export function normalizeResearchReportSummaryImageSettings(
  input: unknown,
): ResearchReportSummaryImageSettings {
  const row = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}

  const model = boundedText(
    row.model,
    "model",
    80,
    DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.model,
  )
  if (!MODEL_RE.test(model)) {
    throw new Error("model contains unsupported characters")
  }

  const qualityRaw = boundedText(
    row.quality,
    "quality",
    16,
    DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.quality,
  )
  if (!RESEARCH_REPORT_IMAGE_QUALITIES.includes(qualityRaw as ResearchReportImageQuality)) {
    throw new Error("quality must be auto, high, medium, or low")
  }

  return {
    visualGuidance: boundedText(
      row.visualGuidance,
      "visualGuidance",
      2000,
      DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.visualGuidance,
    ),
    style: boundedText(
      row.style,
      "style",
      1500,
      DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.style,
    ) || DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.style,
    model,
    quality: qualityRaw as ResearchReportImageQuality,
    width: boundedInteger(
      row.width,
      "width",
      DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.width,
    ),
    height: boundedInteger(
      row.height,
      "height",
      DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS.height,
    ),
  }
}
