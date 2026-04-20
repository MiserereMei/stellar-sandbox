import { Body } from './Simulation';

export interface Vehicle extends Body {
  type: 'rocket' | 'heatProtectedRocket';
  rotation: number; // in radians
  angularVelocity: number; // in rad/s
  isHeatProtected: boolean;
  thrustPower: number;
  length: number;
  maxKineticEnergy: number;
}
