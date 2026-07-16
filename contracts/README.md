# On-Chain Credit Layer (Ethereum Sepolia / GIWA Sepolia)

Turns the off-chain credit score into an **on-chain enforced spending limit**.

```
scoring engine → CreditRegistry.setLimit(agent, limit)   (oracle)
              → EAS attestation of the score              (oracle)
agent's ERC-4337 (ZeroDev Kernel) account ──draw()──▶ CreditVault
                                              enforces limit on-chain, sends mUSDC
```

## Contracts

| Contract              | Role                                                            |
| --------------------- | -------------------------------------------------------------- |
| `MockUSDC`            | 6-decimal test USDC, freely mintable on testnet                |
| `AgentCreditRegistry` | Oracle-published credit limit per agent smart account          |
| `AgentCreditVault`    | Lends mUSDC up to the registry limit; tracks outstanding/repay |

EAS itself is already deployed on Sepolia — you only register a schema.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`forge`)
- A Sepolia RPC URL (Alchemy/Infura/…)
- A funded deployer key (Sepolia ETH from a faucet)
- Two EOAs: **oracle** (publishes limits + attests) and **agent owner**
  (owns every Kernel account). They can be the same key for a demo.
- A [ZeroDev](https://dashboard.zerodev.app/) project → its **RPC URL**
  (bundler + gas-sponsoring paymaster), on Sepolia.

## 1. Deploy the contracts

```bash
cd contracts
forge install foundry-rs/forge-std   # once, for the deploy script
export SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
export ORACLE_ADDRESS=0x<oracle EOA>
export DEPLOYER_PRIVATE_KEY=0x<funded deployer>

forge script script/Deploy.s.sol --rpc-url sepolia --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Note the printed `MockUSDC`, `AgentCreditRegistry`, `AgentCreditVault` addresses.

## 2. Register the EAS schema

Register this exact schema string in the EAS SchemaRegistry on Sepolia
(via [easscan.org](https://sepolia.easscan.org/schema/create) or the SDK):

```
bytes32 agentId,uint256 creditScore,string rating,uint256 creditLimit,string riskLevel
```

Copy the resulting **schema UID**.

## 3. Configure the app (Vercel env)

```
SEPOLIA_RPC_URL=...
ZERODEV_RPC=https://rpc.zerodev.app/api/v3/<projectId>/chain/11155111
ORACLE_PRIVATE_KEY=0x...          # must match ORACLE_ADDRESS above, funded
AGENT_OWNER_PRIVATE_KEY=0x...
CREDIT_REGISTRY_ADDRESS=0x...
CREDIT_VAULT_ADDRESS=0x...
MOCK_USDC_ADDRESS=0x...
EAS_SCHEMA_UID=0x...
```

Redeploy Vercel. The **On-Chain (Sepolia)** card appears on the agent profile.

## 4. Use it

1. **Provision smart account** — derives the agent's Kernel account address and
   publishes its current limit to the registry.
2. **Draw / Repay** — now execute as sponsored USDC UserOps through the agent's
   account; the vault enforces the on-chain limit. Each score recalculation
   re-publishes the limit and writes a fresh EAS attestation.

Every action links to Sepolia Etherscan; attestations are viewable on
sepolia.easscan.org under the agent's smart-account address.

## Deploying to GIWA Sepolia instead

GIWA is an OP Stack, EVM-compatible L2 (chain id 91342) — the same contracts
deploy unchanged. Differences from the Sepolia flow:

```bash
# Deploy + verify (GIWA's explorer is Blockscout, not Etherscan):
export ETHERSCAN_API_KEY=dummy   # foundry quirk: blockscout path still requires the var to exist
forge script script/Deploy.s.sol --rpc-url giwa_sepolia --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --verify --verifier blockscout \
  --verifier-url https://sepolia-explorer.giwa.io/api
```

Gas ETH comes from the GIWA Sepolia faucet or by bridging Sepolia ETH.

**EAS** ships as an OP Stack predeploy on GIWA (`EAS
0x4200000000000000000000000000000000000021`, `SchemaRegistry
0x…0020`) — no easscan UI, so register the schema with cast:

```bash
cast send 0x4200000000000000000000000000000000000020 \
  "register(string,address,bool)" \
  "bytes32 agentId,uint256 creditScore,string rating,uint256 creditLimit,string riskLevel" \
  0x0000000000000000000000000000000000000000 true \
  --rpc-url https://sepolia-rpc.giwa.io --private-key $ORACLE_PRIVATE_KEY
```

The schema UID is in the transaction's `Registered` event log (view it on
https://sepolia-explorer.giwa.io).

**App env for GIWA:** set `ONCHAIN_CHAIN=giwa-sepolia`,
`ONCHAIN_RPC_URL=https://sepolia-rpc.giwa.io`, the five `*_ADDRESS` vars from
the deploy output, and `EAS_SCHEMA_UID`. Do **not** set `ZERODEV_RPC` — GIWA
has no live 4337 bundler/paymaster/Kernel factory yet, so the app falls back
to `AGENT_ACCOUNT_MODE=eoa` (deterministic per-agent EOAs derived from
`AGENT_OWNER_PRIVATE_KEY`; the oracle account auto-tops-up their gas). When
GIWA's 4337 infra goes live, switching back is just setting `ZERODEV_RPC`.

## ERC-8004 registries (optional standards layer)

`src/ERC8004Registries.sol` contains minimal, testnet-grade implementations
of the three ERC-8004 "Trustless Agents" registries (Identity, Reputation,
Validation — see `docs/erc8004-acp-benchmark.md` for the spec mapping and
the two documented simplifications). Deploy to any chain the app runs on:

```bash
forge script script/DeployERC8004.s.sol --rpc-url giwa_sepolia --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --verify --verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api
```

Then set the three `ERC8004_*_ADDRESS` env vars in the app. From that point:
agents self-register in the Identity Registry at provision time (owner =
the agent's own account), every acceptance-test / Proving Ground verdict is
mirrored into the Validation Registry (validator = the oracle), and every
credit recalculation is published as Reputation feedback. The registry
itself rejects self-feedback — grader ≠ solver, enforced on-chain.

## Notes

- The layer is fully optional: with these env vars unset the app runs off-chain,
  exactly as before.
- ZeroDev SDK targets `@zerodev/sdk` ^5.5 with EntryPoint v0.7 / Kernel v3.1.
  If you pin a different version, adjust `lib/onchain/account.ts` accordingly.
- `MockUSDC` is mintable by anyone (testnet only). The deploy seeds the vault
  with 1,000,000 mUSDC; mint more to the vault address if agents exhaust it.
