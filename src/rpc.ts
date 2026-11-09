export interface BrowserUseUsageEvent {
  cost: number;
  steps: number;
  provider: "google" | "jev";
}

export interface MissingKeyEvent {
  provider: "google" | "jev";
  service: "typesafe_ai_api" | "browser-use-google-api-key";
}

export interface StoreSecretParams {
  service: string;
  secret: string;
}

export interface BrowserUseRpc {
  storeKeychainSecret(params: StoreSecretParams): Promise<void>;
  getActiveProvider(): Promise<"google" | "jev">;
  setActiveProvider(provider: "google" | "jev"): Promise<void>;
}
