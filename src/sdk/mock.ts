// Helpers for SolidCash SDK calls under this project's strict TypeScript settings.
import type { NetworkProvider } from '@solidcash/solidcash';
import type { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import type { StatefulContract } from '@solidcash/solidcash/stateful';

/**
 * `MockNetworkProvider` declares `oraclePoolCategory` as `string | undefined` where `NetworkProvider` declares an
 * optional `string`, which `exactOptionalPropertyTypes` rejects (docs/SOLIDCASH-FINDINGS.md, F4).
 */
export function asProvider(mock: MockNetworkProvider): NetworkProvider {
  return mock as unknown as NetworkProvider;
}

type CallBuilder = ReturnType<NonNullable<StatefulContract['call'][string]>>;

/** The call builder of entry point `name`, or an error naming the missing entry. */
export function entry(contract: StatefulContract, name: string, ...args: unknown[]): CallBuilder {
  const fn = contract.call[name];
  if (fn === undefined) throw new Error(`contract has no entry point ${name}`);
  return fn(...(args as Parameters<typeof fn>));
}
