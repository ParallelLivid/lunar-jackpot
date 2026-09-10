/**
 * Depth contracts: a goal set mid-run, paid when it is met, and the only thing
 * in the game that outlives the encounter that created it.
 *
 * It is offered, never imposed — which is what separates it from a run modifier,
 * imposed at launch to colour the whole run. A contract is short-range and costs
 * nothing to ignore; banking before the target simply ends it. The copy leans on
 * that: a contract says what it will pay, never what it will take.
 */

import type { RewardTableId } from "./encounters";

export const CONTRACT_IDS = [
  "contract.survey",
  "contract.core-sample",
  "contract.deep-lease",
] as const;

export type ContractId = (typeof CONTRACT_IDS)[number];

export interface ContractDefinition {
  id: ContractId;
  displayName: string;
  /** Stated as what it pays for, never as what it costs to miss. */
  description: string;
  /**
   * Depths beyond where the contract was taken. Deliberately short: a contract
   * changes the next few decisions rather than becoming the run's whole plan.
   */
  span: number;
  /**
   * What it pays, drawn and committed the moment the contract is accepted. A
   * contract sits in the save across several encounters, so resolving at
   * completion would let a player reload until the payout was good.
   */
  rewardTableId: RewardTableId;
}

export const CONTRACTS: Record<ContractId, ContractDefinition> = {
  "contract.survey": {
    id: "contract.survey",
    displayName: "Survey order",
    description: "The Company wants three more depths charted, and will pay for the walk.",
    span: 3,
    rewardTableId: "reward.contract.survey",
  },
  "contract.core-sample": {
    id: "contract.core-sample",
    displayName: "Core sample",
    description: "Bring the drill five depths further down and the sample is worth a bonus.",
    span: 5,
    rewardTableId: "reward.contract.core-sample",
  },
  "contract.deep-lease": {
    id: "contract.deep-lease",
    displayName: "Deep lease",
    description: "Eight more depths on this lease, and the Company pays out the whole seam.",
    span: 8,
    rewardTableId: "reward.contract.deep-lease",
  },
};

export function isContractId(value: unknown): value is ContractId {
  return typeof value === "string" && (CONTRACT_IDS as readonly string[]).includes(value);
}
