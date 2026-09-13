import { unknownProvider, type ProviderSnapshot } from "../health.ts"

export interface GatusHealthData {
  configured: boolean
}

export async function loadGatusSnapshot(env: Partial<NodeJS.ProcessEnv> = process.env): Promise<ProviderSnapshot<GatusHealthData>> {
  if (!env.QEO_OPS_GATUS_URL) {
    return unknownProvider<GatusHealthData>("gatus", "Not configured")
  }

  return unknownProvider<GatusHealthData>("gatus", "Gatus integration pending QEO-203")
}
