import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const RETAINED_PREFIXES = ['release/', 'recovery/', 'ops/', 'operational/']
const DEFAULT_STALE_DAYS = 14
const DEFAULT_MANIFEST = 'branch-cleanup-manifest.json'
const API_ROOT = 'https://api.github.com'

export function classifyBranch({
  name,
  defaultBranch,
  branchSha,
  latestMergedPrHeadSha,
  hasOpenPr = false,
  aheadBy,
  ageDays = 0,
  staleDays = DEFAULT_STALE_DAYS,
  protectedBranches = new Set(),
  allowContained = false,
}) {
  if (name === defaultBranch || RETAINED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return { decision: 'PROTECTED', reason: 'default-or-operational-retention' }
  }
  if (protectedBranches.has(name) || hasOpenPr) {
    return { decision: 'KEEP_ACTIVE', reason: protectedBranches.has(name) ? 'explicit-retention' : 'open-pr' }
  }
  if (branchSha && latestMergedPrHeadSha && branchSha === latestMergedPrHeadSha) {
    return { decision: 'SAFE_TO_DELETE', reason: 'merged-pr-head-unchanged' }
  }
  if (allowContained && aheadBy === 0 && ageDays >= staleDays) {
    return { decision: 'SAFE_TO_DELETE', reason: 'fully-contained-and-stale' }
  }
  return { decision: 'NEEDS_REVIEW', reason: 'unique-recent-or-ambiguous' }
}

export function parseProtectedBranches(raw = '') {
  return new Set(String(raw).split(',').map((value) => value.trim()).filter(Boolean))
}

export function indexPullsByHead(pulls, repoFullName) {
  const openHeads = new Set()
  const latestMerged = new Map()
  for (const pull of pulls || []) {
    if (pull?.head?.repo?.full_name !== repoFullName) continue
    const ref = pull?.head?.ref
    if (!ref) continue
    if (pull.state === 'open') openHeads.add(ref)
    if (!pull.merged_at) continue
    const previous = latestMerged.get(ref)
    if (!previous || new Date(pull.merged_at).getTime() > new Date(previous.mergedAt).getTime()) {
      latestMerged.set(ref, { mergedAt: pull.merged_at, sha: pull.head.sha })
    }
  }
  return {
    openHeads,
    latestMergedHeadSha: new Map([...latestMerged.entries()].map(([ref, value]) => [ref, value.sha])),
  }
}

export function parseArgs(argv) {
  const result = {
    execute: false,
    includeContained: false,
    staleDays: DEFAULT_STALE_DAYS,
    manifest: DEFAULT_MANIFEST,
    protected: '',
  }
  for (const arg of argv) {
    if (arg === '--execute') result.execute = true
    else if (arg === '--include-contained') result.includeContained = true
    else if (arg.startsWith('--stale-days=')) result.staleDays = Number(arg.slice('--stale-days='.length))
    else if (arg.startsWith('--manifest=')) result.manifest = arg.slice('--manifest='.length)
    else if (arg.startsWith('--protected=')) result.protected = arg.slice('--protected='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isFinite(result.staleDays) || result.staleDays < 1) throw new Error('--stale-days must be >= 1')
  if (!result.manifest) throw new Error('--manifest must not be empty')
  return result
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${body.slice(0, 500)}`)
  }
  if (response.status === 204) return null
  return response.json()
}

async function paginate(path, token) {
  const output = []
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const items = await githubRequest(`${path}${separator}per_page=100&page=${page}`, token)
    if (!Array.isArray(items)) throw new Error(`Expected paginated array from ${path}`)
    output.push(...items)
    if (items.length < 100) return output
  }
}

function daysSince(dateValue, now = Date.now()) {
  const time = new Date(dateValue).getTime()
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.floor((now - time) / 86_400_000))
}

async function containedEvidence(repo, defaultBranch, branch, token) {
  const base = encodeURIComponent(defaultBranch)
  const head = encodeURIComponent(branch.name)
  const comparison = await githubRequest(`/repos/${repo}/compare/${base}...${head}`, token)
  const commit = await githubRequest(`/repos/${repo}/commits/${encodeURIComponent(branch.commit.sha)}`, token)
  const date = commit?.commit?.committer?.date || commit?.commit?.author?.date
  return { aheadBy: comparison.ahead_by, ageDays: daysSince(date) }
}

async function auditRepository({ repo, token, protectedBranches, staleDays, includeContained }) {
  const repository = await githubRequest(`/repos/${repo}`, token)
  const defaultBranch = repository.default_branch
  const [branches, pulls] = await Promise.all([
    paginate(`/repos/${repo}/branches`, token),
    paginate(`/repos/${repo}/pulls?state=all&base=${encodeURIComponent(defaultBranch)}`, token),
  ])
  const pullState = indexPullsByHead(pulls, repo)
  const records = []

  for (const branch of branches) {
    const common = {
      name: branch.name,
      defaultBranch,
      branchSha: branch.commit.sha,
      latestMergedPrHeadSha: pullState.latestMergedHeadSha.get(branch.name),
      hasOpenPr: pullState.openHeads.has(branch.name),
      protectedBranches,
      staleDays,
      allowContained: includeContained,
    }
    let classification = classifyBranch(common)
    let aheadBy = null
    let ageDays = null

    if (includeContained && classification.decision === 'NEEDS_REVIEW' && !common.latestMergedPrHeadSha) {
      const evidence = await containedEvidence(repo, defaultBranch, branch, token)
      aheadBy = evidence.aheadBy
      ageDays = evidence.ageDays
      classification = classifyBranch({ ...common, aheadBy, ageDays })
    }

    records.push({
      branch: branch.name,
      sha: branch.commit.sha,
      decision: classification.decision,
      reason: classification.reason,
      openPr: common.hasOpenPr,
      latestMergedPrHeadSha: common.latestMergedPrHeadSha || null,
      aheadBy,
      ageDays,
    })
  }

  return { repo, defaultBranch, totalBranches: branches.length, records }
}

async function deleteBranch(repo, branch, token) {
  const refPath = branch.split('/').map(encodeURIComponent).join('/')
  await githubRequest(`/repos/${repo}/git/refs/heads/${refPath}`, token, { method: 'DELETE' })
}

function summarize(records) {
  return records.reduce((counts, record) => {
    counts[record.decision] = (counts[record.decision] || 0) + 1
    return counts
  }, {})
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  if (!repo) throw new Error('GITHUB_REPOSITORY is required')
  if (!token) throw new Error('GITHUB_TOKEN is required')

  const protectedBranches = parseProtectedBranches([process.env.PROTECTED_BRANCHES, args.protected].filter(Boolean).join(','))
  const audit = await auditRepository({
    repo,
    token,
    protectedBranches,
    staleDays: args.staleDays,
    includeContained: args.includeContained,
  })
  const safe = audit.records.filter((record) => record.decision === 'SAFE_TO_DELETE')
  const deleted = []
  const failures = []

  if (args.execute) {
    for (const record of safe) {
      try {
        await deleteBranch(repo, record.branch, token)
        deleted.push(record.branch)
        console.log(`[branch-hygiene] deleted ${record.branch} (${record.reason})`)
      } catch (error) {
        failures.push({ branch: record.branch, error: error instanceof Error ? error.message : String(error) })
        console.error(`[branch-hygiene] failed ${record.branch}: ${failures.at(-1).error}`)
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: args.execute ? 'execute' : 'dry-run',
    includeContained: args.includeContained,
    staleDays: args.staleDays,
    repo: audit.repo,
    defaultBranch: audit.defaultBranch,
    beforeCount: audit.totalBranches,
    classified: summarize(audit.records),
    deleted,
    failures,
    records: audit.records,
  }
  await writeFile(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...manifest, records: undefined }, null, 2))
  if (failures.length > 0) process.exitCode = 1
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
}
