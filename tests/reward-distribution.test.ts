import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

type Milestone = { rewardAmount: number; requiredPoints: number; rewardType: string };
type UserMilestone = { claimed: boolean; timestamp: number };

interface Result<T> { ok: boolean; value: T }

class RewardDistributionMock {
  state: {
    contractEnabled: boolean;
    treasuryBalance: number;
    rewardRate: number;
    totalClaims: number;
    admin: string;
    tokenContract: string | null;
    userMilestones: Map<string, UserMilestone>;
    milestoneConfigs: Map<number, Milestone>;
    userPoints: Map<string, number>;
  } = {
    contractEnabled: true,
    treasuryBalance: 1000000,
    rewardRate: 100,
    totalClaims: 0,
    admin: "ST1ADMIN",
    tokenContract: null,
    userMilestones: new Map(),
    milestoneConfigs: new Map(),
    userPoints: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1USER";
  transfers: Array<{ amount: number; from: string; to: string }> = [];

  reset() {
    this.state = {
      contractEnabled: true,
      treasuryBalance: 1000000,
      rewardRate: 100,
      totalClaims: 0,
      admin: "ST1ADMIN",
      tokenContract: null,
      userMilestones: new Map(),
      milestoneConfigs: new Map(),
      userPoints: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1USER";
    this.transfers = [];
  }

  setTokenContract(contractPrincipal: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (this.state.tokenContract !== null) return { ok: false, value: false };
    this.state.tokenContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setRewardRate(newRate: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (newRate <= 0) return { ok: false, value: false };
    this.state.rewardRate = newRate;
    return { ok: true, value: true };
  }

  toggleContractEnabled(): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.contractEnabled = !this.state.contractEnabled;
    return { ok: true, value: true };
  }

  addMilestoneConfig(milestoneId: number, rewardAmount: number, requiredPoints: number, rewardType: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (rewardAmount <= 0 || requiredPoints <= 0) return { ok: false, value: false };
    if (!["learn", "contribute", "verify"].includes(rewardType)) return { ok: false, value: false };
    if (this.state.milestoneConfigs.has(milestoneId)) return { ok: false, value: false };
    this.state.milestoneConfigs.set(milestoneId, { rewardAmount, requiredPoints, rewardType });
    return { ok: true, value: true };
  }

  updateUserPoints(user: string, points: number): Result<boolean> {
    if (!this.state.tokenContract) return { ok: false, value: false };
    if (user === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    if (points <= 0) return { ok: false, value: false };
    const current = this.state.userPoints.get(user) || 0;
    this.state.userPoints.set(user, current + points);
    return { ok: true, value: true };
  }

  claimReward(milestoneId: number): Result<boolean> {
    if (!this.state.contractEnabled) return { ok: false, value: false };
    if (this.caller === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    const milestone = this.state.milestoneConfigs.get(milestoneId);
    if (!milestone) return { ok: false, value: false };
    const userPoints = this.state.userPoints.get(this.caller) || 0;
    const key = `${this.caller}-${milestoneId}`;
    const userMilestone = this.state.userMilestones.get(key) || { claimed: false, timestamp: 0 };
    if (userMilestone.claimed) return { ok: false, value: false };
    if (userPoints < milestone.requiredPoints) return { ok: false, value: false };
    if (this.state.treasuryBalance < milestone.rewardAmount) return { ok: false, value: false };
    if (!this.state.tokenContract) return { ok: false, value: false };
    this.transfers.push({ amount: milestone.rewardAmount, from: "contract", to: this.caller });
    this.state.treasuryBalance -= milestone.rewardAmount;
    this.state.totalClaims++;
    this.state.userMilestones.set(key, { claimed: true, timestamp: this.blockHeight });
    this.state.userPoints.set(this.caller, userPoints - milestone.requiredPoints);
    return { ok: true, value: true };
  }

  getTreasuryBalance(): Result<number> {
    return { ok: true, value: this.state.treasuryBalance };
  }

  getRewardRate(): Result<number> {
    return { ok: true, value: this.state.rewardRate };
  }

  getTotalClaims(): Result<number> {
    return { ok: true, value: this.state.totalClaims };
  }

  getUserPoints(user: string): Result<number> {
    return { ok: true, value: this.state.userPoints.get(user) || 0 };
  }

  getMilestoneConfig(milestoneId: number): Result<Milestone | null> {
    return { ok: true, value: this.state.milestoneConfigs.get(milestoneId) || null };
  }

  getUserMilestone(user: string, milestoneId: number): Result<UserMilestone | null> {
    return { ok: true, value: this.state.userMilestones.get(`${user}-${milestoneId}`) || null };
  }
}

describe("RewardDistribution", () => {
  let contract: RewardDistributionMock;

  beforeEach(() => {
    contract = new RewardDistributionMock();
    contract.reset();
  });

  it("rejects token contract set by non-admin", () => {
    contract.caller = "ST2USER";
    const result = contract.setTokenContract("ST2TOKEN");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects invalid milestone config", () => {
    const result = contract.addMilestoneConfig(1, 0, 50, "learn");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects user points update without token contract", () => {
    const result = contract.updateUserPoints("ST1USER", 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim for already claimed milestone", () => {
    contract.setTokenContract("ST2TOKEN");
    contract.addMilestoneConfig(1, 100, 50, "learn");
    contract.updateUserPoints("ST1USER", 100);
    contract.claimReward(1);
    const result = contract.claimReward(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim with insufficient points", () => {
    contract.setTokenContract("ST2TOKEN");
    contract.addMilestoneConfig(1, 100, 50, "learn");
    contract.updateUserPoints("ST1USER", 40);
    const result = contract.claimReward(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim with insufficient treasury", () => {
    contract.setTokenContract("ST2TOKEN");
    contract.addMilestoneConfig(1, 2000000, 50, "learn");
    contract.updateUserPoints("ST1USER", 100);
    const result = contract.claimReward(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim when contract disabled", () => {
    contract.setTokenContract("ST2TOKEN");
    contract.addMilestoneConfig(1, 100, 50, "learn");
    contract.updateUserPoints("ST1USER", 100);
    contract.toggleContractEnabled();
    const result = contract.claimReward(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});