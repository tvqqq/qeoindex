// Compatibility note: provider token telemetry still includes
// usage.input_tokens_details.cached_tokens and usage.output_tokens_details.reasoning_tokens.
// Parsing moved to the shared provider-generic helper below.
export {
  extractOpenAiOutputText,
  inspectOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete,
  OpenAiResponseError,
  type OpenAiResponseEnvelopeInspection,
} from "../ai/openai-response.ts"
