import {
  attentionFromProviders,
  overallHealthState,
  unknownProvider,
  type AttentionItem,
  type HealthState,
  type ProviderSnapshot,
  type ProviderSource,
} from "./health.ts"
import { loadBeszelSnapshot, type BeszelHealthData } from "./providers/beszel.ts"
import { loadGatusSnapshot, type GatusHealthData } from "./providers/gatus.ts"
import { loadJobsSnapshot, type JobsHealthData } from "./providers/jobs.ts"

export interface OperationsSnapshot {
  status: HealthState
  observedAt: string
  providers: {
    beszel: ProviderSnapshot<BeszelHealthData>
    jobs: ProviderSnapshot<JobsHealthData>
    gatus: ProviderSnapshot<GatusHealthData>
  }
  attention: AttentionItem[]
}

function rejectedProvider<T>(source: ProviderSource): ProviderSnapshot<T> {
  return unknownProvider<T>(source, `${source} health unavailable`)
}

export async function loadOperationsSnapshot(env: Partial<NodeJS.ProcessEnv> = process.env): Promise<OperationsSnapshot> {
  const [beszelResult, jobsResult, gatusResult] = await Promise.allSettled([
    loadBeszelSnapshot(env),
    loadJobsSnapshot(),
    loadGatusSnapshot(env),
  ])

  const beszel = beszelResult.status === "fulfilled"
    ? beszelResult.value
    : rejectedProvider<BeszelHealthData>("beszel")
  const jobs = jobsResult.status === "fulfilled"
    ? jobsResult.value
    : rejectedProvider<JobsHealthData>("jobs")
  const gatus = gatusResult.status === "fulfilled"
    ? gatusResult.value
    : rejectedProvider<GatusHealthData>("gatus")

  const providerList: ProviderSnapshot<unknown>[] = [beszel, jobs, gatus]
  return {
    status: overallHealthState(providerList.map((provider) => provider.status)),
    observedAt: new Date().toISOString(),
    providers: { beszel, jobs, gatus },
    attention: attentionFromProviders(providerList),
  }
}
