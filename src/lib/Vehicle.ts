import { Body } from './Simulation';

export interface Vehicle extends Body {
  type: 'rocket' | 'heatProtectedRocket';
  rotation: number; // in radians
  angularVelocity: number; // in rad/s
  isHeatProtected: boolean;
  thrustPower: number;
  length: number;
  maxKineticEnergy: number;

  // Autopilot & Fleet Management
  script?: string;
  isAutopilotActive?: boolean;
  sandbox?: import('./AutopilotSandbox').AutopilotSandbox;
  autopilotLogs?: {time: number, msg: string}[];
  targetLaunchTime?: number | null;
  launchEpoch?: number | null;
  activeBoosters?: { thrust: number, endTime: number, cbId?: number }[];
}
