const textEncoder = new TextEncoder()

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)))
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }

  return difference === 0
}

export async function isMachineRequestAuthorized(
  request: Request,
  secrets: Array<string | null | undefined>,
) {
  const configured = secrets
    .map((secret) => secret?.trim() ?? "")
    .filter((secret): secret is string => secret.length > 0)

  if (!configured.length) return false

  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return false

  const candidate = authorization.slice("Bearer ".length)
  if (!candidate) return false

  const [candidateDigest, ...secretDigests] = await Promise.all([
    sha256(candidate),
    ...configured.map((secret) => sha256(secret)),
  ])

  let matched = 0
  for (const secretDigest of secretDigests) {
    matched |= constantTimeEqual(candidateDigest, secretDigest) ? 1 : 0
  }

  return matched === 1
}
