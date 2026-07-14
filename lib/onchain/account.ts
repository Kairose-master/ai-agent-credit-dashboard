/**
 * ZeroDev (ERC-4337 / Kernel) smart-account service.
 *
 * Every agent gets its own Kernel smart account, derived deterministically
 * from a single owner key plus a per-agent index (so each agent has a
 * distinct on-chain address without managing N private keys). The account is
 * what draws/repays against the vault, so the on-chain credit limit is
 * enforced against the agent itself.
 *
 * Targets @zerodev/sdk ^5.5 with EntryPoint v0.7 / Kernel v3.1. ZeroDev's RPC
 * (ZERODEV_RPC) serves both the bundler and the (gas-sponsoring) paymaster.
 */
import { http, keccak256, toHex, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from '@zerodev/sdk'
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants'
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator'
import { CHAIN, onchainEnv } from './config'
import { publicClient } from './clients'

const entryPoint = getEntryPoint('0.7')
const kernelVersion = KERNEL_V3_1

/** Stable per-agent account index derived from the agent id. */
export function accountIndex(agentId: string): bigint {
  return BigInt(keccak256(toHex(agentId))) % 2n ** 48n
}

function ownerSigner() {
  const pk = onchainEnv.agentOwnerPrivateKey
  return privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as Hex)
}

/** Build the Kernel account + client for one agent. */
export async function getAgentKernel(agentId: string) {
  const client = publicClient()
  const ecdsaValidator = await signerToEcdsaValidator(client, {
    signer: ownerSigner(),
    entryPoint,
    kernelVersion,
  })

  const account = await createKernelAccount(client, {
    entryPoint,
    kernelVersion,
    plugins: { sudo: ecdsaValidator },
    index: accountIndex(agentId),
  })

  const paymaster = createZeroDevPaymasterClient({
    chain: CHAIN,
    transport: http(onchainEnv.zerodevRpc),
  })

  const kernelClient = createKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(onchainEnv.zerodevRpc),
    client,
    paymaster,
  })

  return { account, kernelClient, address: account.address as Address }
}

/** Just the deterministic smart-account address (no bundler needed to read). */
export async function getAgentAccountAddress(agentId: string): Promise<Address> {
  const client = publicClient()
  const ecdsaValidator = await signerToEcdsaValidator(client, {
    signer: ownerSigner(),
    entryPoint,
    kernelVersion,
  })
  const account = await createKernelAccount(client, {
    entryPoint,
    kernelVersion,
    plugins: { sudo: ecdsaValidator },
    index: accountIndex(agentId),
  })
  return account.address as Address
}

/** Send one call from the agent's account and wait for the receipt. */
export async function sendAgentCall(
  agentId: string,
  call: { to: Address; data: Hex; value?: bigint },
): Promise<Hex> {
  const { account, kernelClient } = await getAgentKernel(agentId)
  const userOpHash = await kernelClient.sendUserOperation({
    callData: await account.encodeCalls([
      { to: call.to, value: call.value ?? 0n, data: call.data },
    ]),
  })
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash })
  return receipt.receipt.transactionHash as Hex
}
