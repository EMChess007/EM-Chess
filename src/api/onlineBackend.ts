/**
 * Whether the app talks to the deployed Render backend (the one that sleeps) rather than a laptop on the LAN. A module of its own so that a component can ask without importing the api
 * client (which reads the platform and the Expo config, and which many tests replace): src/api/client.ts says it once, when it has worked out its address.
 */
let online = false;

export function setOnlineBackend(value: boolean): void {
  online = value;
}

export function isOnlineBackend(): boolean {
  return online;
}
