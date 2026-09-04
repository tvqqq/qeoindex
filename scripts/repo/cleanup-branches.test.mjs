import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyBranch, indexPullsByHead, parseProtectedBranches, parseArgs } from './cleanup-branches.mjs'

test('protects default and explicitly retained branches', () => {
  assert.equal(classifyBranch({ name: 'main', defaultBranch: 'main' }).decision, 'PROTECTED')
  assert.equal(classifyBranch({ name: 'tvq9612/qeo-81-work', defaultBranch: 'main', protectedBranches: new Set(['tvq9612/qeo-81-work']) }).decision, 'KEEP_ACTIVE')
})

test('keeps branches with an open pull request', () => {
  assert.equal(classifyBranch({ name: 'feature/live', defaultBranch: 'main', hasOpenPr: true }).decision, 'KEEP_ACTIVE')
})

test('deletes an unchanged head from a merged pull request', () => {
  assert.equal(classifyBranch({ name: 'feature/done', defaultBranch: 'main', branchSha: 'abc', latestMergedPrHeadSha: 'abc' }).decision, 'SAFE_TO_DELETE')
})

test('does not delete a reused branch after its merged pull request', () => {
  assert.equal(classifyBranch({ name: 'feature/reused', defaultBranch: 'main', branchSha: 'new', latestMergedPrHeadSha: 'old', aheadBy: 1 }).decision, 'NEEDS_REVIEW')
})

test('deletes an old branch fully contained in main only when explicitly enabled', () => {
  assert.equal(classifyBranch({ name: 'legacy/merged', defaultBranch: 'main', aheadBy: 0, ageDays: 45, staleDays: 14, allowContained: true }).decision, 'SAFE_TO_DELETE')
})

test('does not auto-delete a contained branch unless contained cleanup is explicitly enabled', () => {
  assert.equal(classifyBranch({ name: 'legacy/merged', defaultBranch: 'main', aheadBy: 0, ageDays: 45, staleDays: 14 }).decision, 'NEEDS_REVIEW')
})

test('keeps a recent branch without PR metadata even if main contains it', () => {
  assert.equal(classifyBranch({ name: 'feature/new', defaultBranch: 'main', aheadBy: 0, ageDays: 2, staleDays: 14, allowContained: true }).decision, 'NEEDS_REVIEW')
})

test('keeps release recovery and operational branches', () => {
  for (const name of ['release/2026-09', 'recovery/eod', 'ops/manual-fallback']) {
    assert.equal(classifyBranch({ name, defaultBranch: 'main', aheadBy: 0, ageDays: 100, allowContained: true }).decision, 'PROTECTED')
  }
})

test('indexes open and merged pull requests by same-repository head branch', () => {
  const pulls = [
    { state: 'open', merged_at: null, head: { ref: 'feature/live', sha: '1', repo: { full_name: 'tvqqq/qeoindex' } } },
    { state: 'closed', merged_at: '2026-09-01T00:00:00Z', head: { ref: 'feature/done', sha: '2', repo: { full_name: 'tvqqq/qeoindex' } } },
    { state: 'closed', merged_at: '2026-08-01T00:00:00Z', head: { ref: 'feature/done', sha: 'old', repo: { full_name: 'tvqqq/qeoindex' } } },
    { state: 'closed', merged_at: '2026-09-02T00:00:00Z', head: { ref: 'forked', sha: '3', repo: { full_name: 'someone/fork' } } },
  ]
  const state = indexPullsByHead(pulls, 'tvqqq/qeoindex')
  assert.equal(state.openHeads.has('feature/live'), true)
  assert.equal(state.latestMergedHeadSha.get('feature/done'), '2')
  assert.equal(state.latestMergedHeadSha.has('forked'), false)
})

test('parses explicit retained branches without empty values', () => {
  assert.deepEqual([...parseProtectedBranches(' a, b ,,a ')].sort(), ['a', 'b'])
})

test('CLI defaults to dry-run and requires explicit flags for destructive modes', () => {
  assert.deepEqual(parseArgs([]), {
    execute: false,
    includeContained: false,
    staleDays: 14,
    manifest: 'branch-cleanup-manifest.json',
    protected: '',
  })
  assert.deepEqual(parseArgs(['--execute', '--include-contained', '--stale-days=30', '--manifest=out.json', '--protected=a,b']), {
    execute: true,
    includeContained: true,
    staleDays: 30,
    manifest: 'out.json',
    protected: 'a,b',
  })
})
