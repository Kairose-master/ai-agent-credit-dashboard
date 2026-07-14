# On-Chain Credit Layer (Ethereum Sepolia)

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

## Notes

- The layer is fully optional: with these env vars unset the app runs off-chain,
  exactly as before.
- ZeroDev SDK targets `@zerodev/sdk` ^5.5 with EntryPoint v0.7 / Kernel v3.1.
  If you pin a different version, adjust `lib/onchain/account.ts` accordingly.
- `MockUSDC` is mintable by anyone (testnet only). The deploy seeds the vault
  with 1,000,000 mUSDC; mint more to the vault address if agents exhaust it.
