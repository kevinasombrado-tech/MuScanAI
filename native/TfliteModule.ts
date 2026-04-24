import { NativeModules } from 'react-native';

export type RunResult = {
  label: string;
  probs: number[]; // [Functional, Mild, Moderate, Severe]
};

export type GatekeeperResult = {
  label: 'Banana' | 'Not Banana';
  confidence: number;
};

const { TfliteModule } = NativeModules as {
  TfliteModule?: { 
    run(source: string): Promise<RunResult>;
    runGatekeeper(source: string): Promise<GatekeeperResult>;
  };
};

export async function runTflite(source: string): Promise<RunResult> {
  if (!TfliteModule) {
    throw new Error('TfliteModule not linked');
  }
  return TfliteModule.run(source);
}

export async function runGatekeeper(source: string): Promise<GatekeeperResult> {
  if (!TfliteModule) {
    throw new Error('TfliteModule not linked');
  }
  return TfliteModule.runGatekeeper(source);
}

