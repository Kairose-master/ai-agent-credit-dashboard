import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      // Scope coverage to the pure-logic layer the unit suite targets, so the
      // number reflects the code that is meant to be unit-tested. The
      // integration tier below is deliberately excluded: it requires a live
      // chain, database, or LLM to exercise and is covered by scenario docs /
      // manual runs, not by these fast, hermetic unit tests.
      include: ['lib/**/*.ts'],
      exclude: [
        'lib/**/*.d.ts',
        'lib/**/index.ts',
        'lib/db/**', // Drizzle schema + queries — needs a live Postgres
        'lib/onchain/**', // viem/chain calls — needs an RPC + deployed contracts
        'lib/credit-engine/**', // scoring pipeline — needs persisted event history
        'lib/agent-runtime/**', // spawns real agent processes
        'lib/api/**', // request/response glue over the layers above
        'lib/bpmn/**', // BPMN diagram wiring
        'lib/verifiable/**', // ZK/verifiable-compute stubs
      ],
      // Regression floor, set just under today's numbers. New logic that ships
      // without tests and drags coverage below these lines fails CI — the point
      // is to ratchet, not to chase a vanity percentage.
      thresholds: {
        statements: 25,
        branches: 25,
        functions: 30,
        lines: 25,
      },
    },
  },
})
