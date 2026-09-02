export function parseMigrationFilename(filename) {
  const match = /^(\d+)_([a-z0-9_]+)\.sql$/i.exec(filename)
  if (!match) return null
  return { version: match[1], logicalName: match[2] }
}

function indexFiles(files, label, errors) {
  const map = new Map()
  for (const filename of files) {
    const parsed = parseMigrationFilename(filename)
    if (!parsed) continue
    if (map.has(parsed.logicalName)) {
      errors.push(`duplicate ${label} logical migration: ${parsed.logicalName}`)
      continue
    }
    map.set(parsed.logicalName, { ...parsed, filename })
  }
  return map
}

export function reconcileMigrations({ activeFiles, pendingFiles, productionLedger, manifest }) {
  const errors = []
  const active = indexFiles(activeFiles, "active", errors)
  const pending = indexFiles(pendingFiles, "pending", errors)
  const production = new Map()
  for (const row of productionLedger) {
    if (production.has(row.name)) errors.push(`duplicate production logical migration: ${row.name}`)
    production.set(row.name, row)
  }

  const mappings = new Map()
  for (const entry of manifest.migrations ?? []) {
    if (mappings.has(entry.logicalName)) {
      errors.push(`duplicate manifest logical migration: ${entry.logicalName}`)
      continue
    }
    mappings.set(entry.logicalName, entry)
  }

  const names = new Set([...active.keys(), ...pending.keys(), ...production.keys(), ...mappings.keys()])

  for (const logicalName of [...names].sort()) {
    const source = active.get(logicalName)
    const queued = pending.get(logicalName)
    const prod = production.get(logicalName)
    const mapping = mappings.get(logicalName)

    if (source && queued) errors.push(`${logicalName}: migration exists in both active and pending directories`)

    if (queued && prod) {
      errors.push(`${logicalName}: production-applied migration cannot remain pending`)
      continue
    }

    if (!mapping) {
      if (source && prod && source.version === prod.version) continue
      if (source && !prod) errors.push(`${logicalName}: unexplained repo-only active migration ${source.version}`)
      if (prod && !source) errors.push(`${logicalName}: unexplained production-only migration ${prod.version}`)
      if (source && prod && source.version !== prod.version) {
        errors.push(`${logicalName}: timestamp drift ${source.version} -> ${prod.version} requires explicit mapping`)
      }
      if (queued && !prod) errors.push(`${logicalName}: pending migration requires explicit manifest state`)
      continue
    }

    const { repositoryVersion, productionVersion, state } = mapping

    if (state === "QUARANTINED") {
      if (!queued) errors.push(`${logicalName}: quarantined migration is missing from pending directory`)
      if (source) errors.push(`${logicalName}: quarantined migration must not be active`)
      if (prod) errors.push(`${logicalName}: quarantined migration is already present in production`)
      if (productionVersion !== null) errors.push(`${logicalName}: quarantined productionVersion must be null`)
      if (queued && queued.version !== repositoryVersion) errors.push(`${logicalName}: pending source version changed from ${repositoryVersion} to ${queued.version}`)
      continue
    }

    if (!source) {
      errors.push(`${logicalName}: manifest state ${state} requires an active source migration`)
      continue
    }
    if (!prod) {
      errors.push(`${logicalName}: manifest state ${state} requires a production ledger row`)
      continue
    }
    if (source.version !== repositoryVersion) errors.push(`${logicalName}: source version ${source.version} does not match manifest ${repositoryVersion}`)
    if (prod.version !== productionVersion) errors.push(`${logicalName}: production version ${prod.version} does not match manifest ${productionVersion}`)

    if (state === "EXACT" && repositoryVersion !== productionVersion) {
      errors.push(`${logicalName}: EXACT mapping requires identical versions`)
    } else if (!new Set(["EXACT", "MAPPED", "ALLOWED_TRANSIENT"]).has(state)) {
      errors.push(`${logicalName}: unsupported manifest state ${state}`)
    }
  }

  errors.sort()
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      active: active.size,
      pending: pending.size,
      production: production.size,
      explicitMappings: mappings.size,
    },
  }
}
