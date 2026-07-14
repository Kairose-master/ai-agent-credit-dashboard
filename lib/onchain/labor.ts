/**
 * On-chain labor market operations. Writes go through the acting agent's
 * ERC-4337 account (sponsored UserOps); reads come straight from the contract.
 */
import { encodeFunctionData, parseUnits, type Address, type Hex } from 'viem'
import { LABOR_MARKET_ABI, USDC_ABI, USDC_DECIMALS, JOB_STATUS, onchainEnv } from './config'
import { publicClient } from './clients'
import { getAgentKernel, sendAgentCall } from './account'

const toUnits = (usd: number) => parseUnits(usd.toFixed(USDC_DECIMALS), USDC_DECIMALS)
const fromUnits = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS

export type OnchainJob = {
  id: number
  requester: Address
  worker: Address
  bounty: number
  minScore: number
  status: (typeof JOB_STATUS)[number]
  specHash: Hex
  resultHash: Hex
}

/** Post a job: approve the market for the bounty and postJob, atomically. */
export async function postJob(
  requesterAgentId: string,
  bountyUsd: number,
  minScore: number,
  specHash: Hex,
): Promise<Hex> {
  const amount = toUnits(bountyUsd)
  const approve = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'approve',
    args: [onchainEnv.laborMarketAddress as Address, amount],
  })
  const post = encodeFunctionData({
    abi: LABOR_MARKET_ABI,
    functionName: 'postJob',
    args: [amount, BigInt(minScore), specHash],
  })

  const { account, kernelClient } = await getAgentKernel(requesterAgentId)
  const userOpHash = await kernelClient.sendUserOperation({
    callData: await account.encodeCalls([
      { to: onchainEnv.usdcAddress as Address, value: 0n, data: approve },
      { to: onchainEnv.laborMarketAddress as Address, value: 0n, data: post },
    ]),
  })
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash })
  return receipt.receipt.transactionHash as Hex
}

function marketCall(fn: 'acceptJob' | 'approveJob' | 'cancelJob', jobId: number) {
  return encodeFunctionData({ abi: LABOR_MARKET_ABI, functionName: fn, args: [BigInt(jobId)] })
}

export async function acceptJob(workerAgentId: string, jobId: number): Promise<Hex> {
  return sendAgentCall(workerAgentId, {
    to: onchainEnv.laborMarketAddress as Address,
    data: marketCall('acceptJob', jobId),
  })
}

export async function submitWork(workerAgentId: string, jobId: number, resultHash: Hex): Promise<Hex> {
  const data = encodeFunctionData({
    abi: LABOR_MARKET_ABI,
    functionName: 'submitWork',
    args: [BigInt(jobId), resultHash],
  })
  return sendAgentCall(workerAgentId, { to: onchainEnv.laborMarketAddress as Address, data })
}

export async function approveJob(requesterAgentId: string, jobId: number): Promise<Hex> {
  return sendAgentCall(requesterAgentId, {
    to: onchainEnv.laborMarketAddress as Address,
    data: marketCall('approveJob', jobId),
  })
}

export async function cancelJob(requesterAgentId: string, jobId: number): Promise<Hex> {
  return sendAgentCall(requesterAgentId, {
    to: onchainEnv.laborMarketAddress as Address,
    data: marketCall('cancelJob', jobId),
  })
}

/** Read all jobs from the contract (small N — fine for a prototype). */
export async function readJobs(): Promise<OnchainJob[]> {
  const client = publicClient()
  const count = (await client.readContract({
    address: onchainEnv.laborMarketAddress as Address,
    abi: LABOR_MARKET_ABI,
    functionName: 'jobCount',
  })) as bigint

  const jobs: OnchainJob[] = []
  for (let i = 1n; i <= count; i++) {
    const j = (await client.readContract({
      address: onchainEnv.laborMarketAddress as Address,
      abi: LABOR_MARKET_ABI,
      functionName: 'jobs',
      args: [i],
    })) as readonly [Address, Address, bigint, bigint, number, Hex, Hex]
    jobs.push({
      id: Number(i),
      requester: j[0],
      worker: j[1],
      bounty: fromUnits(j[2]),
      minScore: Number(j[3]),
      status: JOB_STATUS[j[4]] ?? 'Open',
      specHash: j[5],
      resultHash: j[6],
    })
  }
  return jobs.reverse() // newest first
}
