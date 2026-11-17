import { describe, expect, it } from 'vitest';
import { ethers } from '@solidcash/solidhat/hardhat3';

describe('Counter', () => {
  it('loads its factory', async () => {
    const factory = await ethers.getContractFactory('Counter');
    expect(factory).toBeDefined();
  });
});
