export type Vector2 = { x: number; y: number };

export interface Body {
  id: string;
  name: string;
  mass: number;
  radius: number;
  color: string;
  position: Vector2;
  velocity: Vector2;
  trail: Vector2[];
  projectedTrail?: Vector2[];
  isBlackHole?: boolean;
}

import { Vehicle } from './Vehicle';
import { AutopilotSandbox } from './AutopilotSandbox';
import orbitScript from '../scripts/autopilot/auto-orbit.js?raw';

export class Simulation {
  bodies: Body[] = [];
  vehicle: Vehicle | null = null;
  G: number = 0.5;
  timeScale: number = 1.0;
  paused: boolean = false;
  isJumping: boolean = false;
  jumpProgress: number = 0;
  cancelJump: boolean = false;
  private pendingJump: (() => void) | null = null;
  camera = { x: 0, y: 0, zoom: 1, followingId: null as string | null };
  selectedBodyId: string | null = null;
  secondsPerSimSecond: number = 1.0;

  private lastFollowId: string | null = null;
  private camStartX: number = 0;
  private camStartY: number = 0;
  private camTransition: number = 1;

  trailAccumulator: number = 0;

  previewBody: Body | null = null;
  previewVelocityVector: { start: Vector2, end: Vector2 } | null = null;
  orbitPreview: { parentId: string, mousePos: Vector2 } | null = null;
  rulerStartPoint: Vector2 | null = null;
  mouseWorldPos: Vector2 = { x: 0, y: 0 };

  creationTemplate: { presetType: 'star' | 'planet' | 'moon' | 'comet' | 'blackhole' | 'rocket' | 'heatProtectedRocket' } = { presetType: 'planet' };

  physicsScale: number = 1.0;
  C: number = 300;

  isBodyBlackHole(body: { mass: number, radius: number, isBlackHole?: boolean }): boolean {
    if (body.isBlackHole) return true;
    const schwarzschildRadius = (2 * this.G * Math.abs(body.mass)) / (this.C * this.C);
    return body.radius <= schwarzschildRadius * 4.0 && body.mass > 0;
  }

  isStar(body: { name: string }): boolean {
    const starLabels = ['Star', 'Sun', 'Alpha', 'Beta', 'Proxima'];
    return starLabels.some(label => body.name.includes(label));
  }

  getDominantBody(position: Vector2): any | null {
    let dominant = null;
    let maxInfluence = -Infinity;
    for (const b of this.bodies) {
      if (b.mass <= 0) continue;
      const dx = b.position.x - position.x;
      const dy = b.position.y - position.y;
      const distSq = dx * dx + dy * dy + 0.001;
      const influence = b.mass / distSq;
      if (influence > maxInfluence) {
        maxInfluence = influence;
        dominant = b;
      }
    }
    return dominant;
  }

  getBodyMetadataFromPreset(): { name: string, mass: number, radius: number, length?: number, color: string, isBlackHole?: boolean, thrustPower?: number, maxKineticEnergy?: number } {
    const p = this.creationTemplate.presetType;
    if (p === 'star') {
      return { name: `Star ${this.bodies.length + 1}`, mass: 333000, radius: 109, color: 'hsl(45, 100%, 50%)' };
    } else if (p === 'planet') {
      return { name: `Planet ${this.bodies.length + 1}`, mass: 1.0, radius: 1.0, color: `hsl(${Math.random() * 360}, 70%, 50%)` };
    } else if (p === 'moon') {
      return { name: `Moon ${this.bodies.length + 1}`, mass: 0.0123, radius: 0.273, color: `hsl(${Math.random() * 360}, 30%, 70%)` };
    } else if (p === 'blackhole') {
      const mass = 3.33e9; // ~10 million solar masses in Earth masses
      const rs = (2 * this.G * mass) / (this.C * this.C);
      return { name: `Black Hole ${this.bodies.length + 1}`, mass, radius: rs * 2.6, color: '#000000', isBlackHole: true };
    } else if (p === 'rocket') {
      // Artemis 2 / SLS Block 1: 2.6M kg (4.35e-19 Earth Mass), 98m length (1.54e-5 Earth Radii)
      // Core Stage Boosted (TWR 1.6): ~40 MN (2.5e-6 sim units). 
      // Powerful enough to reach orbit without staging.
      const length = 1.538e-5;
      return { name: 'Artemis SLS', mass: 4.353e-19, radius: length / 2, length, color: '#ffffff', thrustPower: 2.5e-6, maxKineticEnergy: 20000 };
    } else if (p === 'heatProtectedRocket') {
      const length = 1.538e-5;
      return { name: 'Artemis SLS (Shielded)', mass: 4.353e-19, radius: length / 2, length, color: '#f97316', thrustPower: 2.77e-6, maxKineticEnergy: 50000 };
    } else {
      return { name: `Comet ${this.bodies.length + 1}`, mass: 2e-11, radius: 0.002, color: 'hsl(180, 50%, 80%)' };
    }
  }

  clear() {
    this.bodies = [];
    this.vehicle = null;
    this.trailAccumulator = 0;
    this.camera.followingId = null;
    this.G = 1.541e-6;
    this.timeScale = 1.0;
    this.missionTime = 0;
    this.secondsPerSimSecond = 1.0;
    this.isAutopilotActive = false;
    this.targetLaunchTime = null;
    this.launchEpoch = null;
    this.activeBoosters = [];
    this.cinematicCamera.active = false;
  }

  addBody(x: number, y: number, vx: number = 0, vy: number = 0): Body {
    const meta = this.getBodyMetadataFromPreset();
    const id = generateId();
    const isVehicle = this.creationTemplate.presetType === 'rocket' || this.creationTemplate.presetType === 'heatProtectedRocket';

    const body: any = {
      id,
      ...meta,
      position: { x, y },
      velocity: { x: vx, y: vy },
      trail: []
    };

    if (isVehicle) {
      body.type = this.creationTemplate.presetType;
      body.rotation = -Math.PI / 2;
      body.angularVelocity = 0;
      body.isHeatProtected = this.creationTemplate.presetType === 'heatProtectedRocket';
      body.thrustPower = meta.thrustPower || 0;
      body.maxKineticEnergy = meta.maxKineticEnergy || 20000;
      this.vehicle = body;
    }

    this.bodies.push(body);
    return body;
  }

  loadSolarSystem() {
    this.clear();
    const sunId = generateId();
    const SUN_M = 333000, SUN_R = 109;
    this.bodies.push({
      id: sunId, name: 'Sun', mass: SUN_M, radius: SUN_R, color: 'hsl(45, 100%, 50%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    });

    const planets = [
      { name: 'Mercury', dist: 1000, mass: 0.055, r: 20, color: 'hsl(0, 0%, 60%)' },
      { name: 'Venus', dist: 1800, mass: 0.815, r: 30, color: 'hsl(30, 80%, 70%)' },
      { name: 'Earth', dist: 2500, mass: 1.0, r: 35, color: 'hsl(210, 80%, 60%)' },
      { name: 'Mars', dist: 3500, mass: 0.107, r: 25, color: 'hsl(0, 80%, 50%)' },
      { name: 'Jupiter', dist: 8000, mass: 317.8, r: 80, color: 'hsl(20, 60%, 60%)' },
    ];

    planets.forEach(p => {
      const v = Math.sqrt(this.G * SUN_M / p.dist);
      const id = generateId();
      this.bodies.push({
        id, name: p.name, mass: p.mass, radius: p.r, color: p.color,
        position: { x: p.dist, y: 0 }, velocity: { x: 0, y: v }, trail: []
      });
    });

    this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 0.04;
    this.camera.followingId = sunId;
  }

  loadRocketSystem() {
    this.clear();
    this.timeScale = 300; // 1 real second = 5 sim minutes (makes orbital flight playable)
    // Real Earth: mass=1 Earth mass, radius=1 Earth radius
    const planetId = generateId();
    const planet: Body = {
      id: planetId, name: 'Earth', mass: 1.0, radius: 1.0, color: 'hsl(210, 80%, 60%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    };
    this.bodies.push(planet);

    // Rocket on Earth's surface
    this.creationTemplate.presetType = 'rocket';
    const meta = this.getBodyMetadataFromPreset();
    const rocketId = generateId();
    const rocket: any = {
      id: rocketId,
      ...meta,
      trail: [],
      position: { x: 0, y: -(planet.radius + meta.radius) },
      velocity: { x: 0, y: 0 },
      rotation: -Math.PI / 2,
      type: 'rocket',
      angularVelocity: 0,
      isHeatProtected: false,
      thrustPower: meta.thrustPower,
      size: meta.radius,
      maxKineticEnergy: meta.maxKineticEnergy,
      parentBodyId: planetId,
      relativeOffset: { x: 0, y: -(planet.radius + meta.radius) }
    };
    this.vehicle = rocket;
    this.bodies.push(rocket);

    this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 200;
    this.camera.followingId = planetId;
  }

  loadRealScaleSolarSystem() {
    this.clear();
    // G is scaled so that 1 sim-second = 1 real-world second.
    // T = 31557600s (1 year). R = 23481. M = 333000. 
    // G = 4 * pi^2 * R^3 / (T^2 * M) = 1.541e-6
    this.G = 1.541e-6; 
    const sunId = generateId();
    this.timeScale = 1.0; // Scaled time for standard physics
    this.secondsPerSimSecond = 1.0; // 1 sim-sec = exactly 1 real second!

    const SUN_M = 333000;
    this.bodies.push({
      id: sunId, name: 'Sun', mass: SUN_M, radius: 109.1, color: 'hsl(45, 100%, 50%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    });

    const AU = 23481; // 1 AU = 23,481 Earth Radii (True 1:1 Scale)
    const vScale = Math.sqrt(this.G * SUN_M / AU) / 0.01720209895; // Conversion factor for AU/day to Sim units

    // Authentic NASA JPL Horizons State Vectors (Jan 1, 2000)
    // Masses are exactly in Earth Masses (Earth = 1.0)
    // Radii are in Earth Radii (Earth = 1.0) so UI is 1:1 perfect.
    const planetsData = [
      { name: 'Mercury', x: -1.40728e-01, y: -4.43900e-01, vx: 2.11688e-02, vy: -7.09797e-03, mass: 0.055, r: 0.38, color: 'hsl(0, 0%, 60%)' },
      { name: 'Venus',   x: -7.18630e-01, y: -2.25038e-02, vx: 5.13532e-04, vy: -2.03061e-02, mass: 0.815, r: 0.95, color: 'hsl(30, 80%, 70%)' },
      { name: 'Earth',   x: -1.68524e-01, y: 9.68783e-01,  vx: -1.72339e-02, vy: -3.00766e-03, mass: 1.0, r: 1.0, color: 'hsl(210, 80%, 60%)' },
      { name: 'Mars',    x: 1.39036e+00,  y: -2.10097e-02, vx: 7.47927e-04, vy: 1.51862e-02, mass: 0.107, r: 0.53, color: 'hsl(0, 80%, 50%)' },
      { name: 'Jupiter', x: 4.00346e+00,  y: 2.93535e+00,  vx: -4.56375e-03, vy: 6.44727e-03, mass: 317.8, r: 11.2, color: 'hsl(20, 60%, 60%)' },
      { name: 'Saturn',  x: 6.40855e+00,  y: 6.56804e+00,  vx: -4.29054e-03, vy: 3.89199e-03, mass: 95.2, r: 9.4, color: 'hsl(40, 50%, 70%)' },
      { name: 'Uranus',  x: 1.44305e+01,  y: -1.37356e+01, vx: 2.67846e-03, vy: 2.67242e-03, mass: 14.5, r: 4.0, color: 'hsl(180, 50%, 80%)' },
      { name: 'Neptune', x: 1.68107e+01,  y: -2.49926e+01, vx: 2.57921e-03, vy: 1.77635e-03, mass: 17.1, r: 3.9, color: 'hsl(220, 70%, 60%)' },
    ];

    planetsData.forEach(p => {
      const id = generateId();
      const posX = p.x * AU;
      const posY = p.y * AU;
      const velX = p.vx * vScale;
      const velY = p.vy * vScale;

      this.bodies.push({
        id, name: p.name, mass: p.mass, radius: p.r, color: p.color,
        position: { x: posX, y: posY }, 
        velocity: { x: velX, y: velY }, 
        trail: []
      });

      if (p.name === 'Earth') {
        const mDist = 60; // 60 Earth Radii
        const mV = Math.sqrt(this.G * p.mass / mDist);
        this.bodies.push({
          id: generateId(), name: 'Moon', mass: 0.0123, radius: 0.27, color: 'hsl(0, 0%, 80%)',
          position: { x: posX + mDist, y: posY }, 
          velocity: { x: velX, y: velY + mV }, 
          trail: []
        });
      }
    });

    this.camera.x = 0; this.camera.y = 0;
    this.camera.zoom = 0.03; 
    this.camera.followingId = sunId;
  }

  loadOECSystem(system: any) {
    this.clear();
    this.G = 11508; // Correct G for AU=23481, M=333000, T=1day
    this.timeScale = 86400; // 1 day per sec
    this.secondsPerSimSecond = 1.0; // In this system, 1 sim-sec = 1 real sec, but timescale scales it.

    const AU = 23481;
    const SOLAR_MASS = 333000;
    const JUPITER_MASS = 317.8;
    const SOLAR_RADIUS = 109;
    const JUPITER_RADIUS = 11.2;

    const starId = generateId();
    const starMass = system.star.mass * SOLAR_MASS;
    const starRadius = system.star.radius * SOLAR_RADIUS;
    
    // Get color based on temperature
    let starColor = 'hsl(45, 100%, 50%)';
    if (system.star.temp < 3700) starColor = 'hsl(10, 100%, 60%)'; // M-Dwarf
    else if (system.star.temp < 5200) starColor = 'hsl(30, 100%, 60%)'; // K-Dwarf
    else if (system.star.temp > 7500) starColor = 'hsl(200, 100%, 80%)'; // A/B-Type

    this.bodies.push({
        id: starId,
        name: system.name,
        mass: starMass,
        radius: Math.max(5, starRadius), // Minimum visual size
        color: starColor,
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        trail: []
    });

    system.planets.forEach((p: any) => {
        if (p.semimajoraxis <= 0) return;
        const dist = p.semimajoraxis * AU;
        const mass = p.mass > 0 ? p.mass * JUPITER_MASS : 1.0; 
        const radius = p.radius > 0 ? p.radius * JUPITER_RADIUS : 1.0;
        
        const v = Math.sqrt((this.G * starMass) / dist);
        const ecc = p.eccentricity || 0;
        const rp = dist * (1 - ecc);
        const vp = v * Math.sqrt((1 + ecc) / (1 - ecc));

        // Visual radius scaling balanced for the new 200x zoom
        const visualRadius = Math.max(8, radius * 1.5); 

        this.bodies.push({
            id: generateId(),
            name: p.name,
            mass: mass,
            radius: visualRadius,
            color: p.temperature > 300 ? 'hsl(20, 70%, 50%)' : 'hsl(200, 70%, 50%)',
            position: { x: rp, y: 0 },
            velocity: { x: 0, y: vp },
            trail: []
        });
    });

    this.camera.followingId = starId;
    this.camera.x = 0;
    this.camera.y = 0;
    
    // HUGE FIX: Zoom was 200x too small. Setting it to a usable scale.
    // 1 AU should be around 250-500 pixels for a "close" start.
    const innerA = system.planets[0]?.semimajoraxis || 1.0;
    this.camera.zoom = 0.1 / Math.max(0.1, innerA); // Much larger zoom
  }

  loadAsteroidBelt() {
    this.clear();
    const sunId = generateId();
    const SUN_M = 333000;
    this.bodies.push({
      id: sunId, name: 'Sun', mass: SUN_M, radius: 109, color: 'hsl(45, 100%, 50%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    });

    for (let i = 0; i < 200; i++) {
      const dist = 4500 + Math.random() * 1500; // Asteroid belt between Mars & Jupiter
      const angle = Math.random() * Math.PI * 2;
      const v = Math.sqrt(this.G * SUN_M / dist);
      this.bodies.push({
        id: generateId(), name: `Asteroid ${i}`, mass: 1e-6, radius: 0.05, color: 'hsl(0, 0%, 50%)',
        position: { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist },
        velocity: { x: -Math.sin(angle) * v, y: Math.cos(angle) * v },
        trail: []
      });
    }
    this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 0.04;
    this.camera.followingId = sunId;
  }

  loadTrisolarSystem() {
    this.clear();
    const M = 100000; // ~0.3 solar masses each
    const dist = 1500;
    const v = Math.sqrt(this.G * M / dist) * 0.8;
    const s1Id = generateId();
    this.bodies.push({
      id: s1Id, name: 'Alpha', mass: M, radius: 60, color: 'hsl(200, 100%, 60%)',
      position: { x: 0, y: -dist }, velocity: { x: v, y: 0 }, trail: []
    });
    this.bodies.push({
      id: generateId(), name: 'Beta', mass: M, radius: 60, color: 'hsl(60, 100%, 50%)',
      position: { x: dist * 0.866, y: dist * 0.5 }, velocity: { x: -v * 0.5, y: -v * 0.866 }, trail: []
    });
    this.bodies.push({
      id: generateId(), name: 'Proxima', mass: M * 0.8, radius: 50, color: 'hsl(0, 100%, 50%)',
      position: { x: -dist * 0.866, y: dist * 0.5 }, velocity: { x: -v * 0.5, y: v * 0.866 }, trail: []
    });
    this.bodies.push({
      id: generateId(), name: 'San-Ti', mass: 1.0, radius: 1.0, color: 'hsl(120, 50%, 50%)',
      position: { x: 0, y: 0 }, velocity: { x: v * 0.5, y: -v * 0.2 }, trail: []
    });
    this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 0.1;
    this.camera.followingId = s1Id;
  }

  loadMeteorShower() {
    this.clear();
    const earthId = generateId();
    this.bodies.push({
      id: earthId, name: 'Earth', mass: 1.0, radius: 1.0, color: 'hsl(210, 80%, 60%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    });
    const mDist = 60; // ~60 Earth radii ≈ real lunar orbit
    const mV = Math.sqrt(this.G * 1.0 / mDist);
    this.bodies.push({
      id: generateId(), name: 'Moon', mass: 0.0123, radius: 0.273, color: 'hsl(0, 0%, 80%)',
      position: { x: mDist, y: 0 }, velocity: { x: 0, y: mV }, trail: []
    });
    for (let i = 0; i < 50; i++) {
      const startX = -2000 - Math.random() * 1000;
      const startY = (Math.random() - 0.5) * 2000;
      const vMeteor = Math.sqrt(2 * this.G * 1.0 / 1.0) * (1.2 + Math.random() * 0.5); // escape velocity-ish
      this.bodies.push({
        id: generateId(), name: `Meteor ${i}`, mass: 1e-8, radius: 0.005, color: 'hsl(25, 100%, 60%)',
        position: { x: startX, y: startY }, velocity: { x: vMeteor, y: (Math.random() - 0.5) * vMeteor * 0.3 }, trail: []
      });
    }
    this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 5;
    this.camera.followingId = earthId;
  }

  loadBlackHoleSystem() {
    this.clear();
    const bhId = generateId();
    // ~10 million solar masses (like a galaxy-center BH)
    const M_bh = 3.33e9;
    const rs = (2 * this.G * M_bh) / (this.C * this.C);
    this.bodies.push({
      id: bhId, name: 'Gargantua', mass: M_bh, radius: rs * 2.6, color: '#000000',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: [], isBlackHole: true
    });
    const s1Dist = 20000;
    const s1V = Math.sqrt(this.G * M_bh / s1Dist);
    this.bodies.push({
      id: generateId(), name: 'Pantagruel', mass: 333000, radius: 109, color: 'hsl(200, 100%, 60%)',
      position: { x: s1Dist, y: 0 }, velocity: { x: 0, y: s1V }, trail: []
    });
    const cDist = rs * 3;
    const cV = Math.sqrt(this.G * M_bh / cDist) * 1.1;
    this.bodies.push({
      id: generateId(), name: 'TARS-1', mass: 1.0, radius: 1.0, color: '#ffffff',
      position: { x: cDist, y: 0 }, velocity: { x: 0, y: cV }, trail: []
    });
    this.camera.x = 0; this.camera.y = 0; this.camera.zoom = 0.0001;
    this.camera.followingId = bhId;
  }

  public isAutopilotActive = false;
  public missionTime = 0;
  public currentScript = '';
  public targetLaunchTime: number | null = null;
  public launchEpoch: number | null = null;
  public activeBoosters: { thrust: number, endTime: number, cbId?: number }[] = [];
  
  public cinematicCamera = {
    active: false,
    zoomScale: -1,
    targetZoomScale: 0.5,
    zoomStart: 0.5,
    zoomTime: 0,
    zoomDuration: 0,
    offsetX: 0,
    offsetY: 0,
    targetOffsetX: 0,
    targetOffsetY: 0,
    offsetStartX: 0,
    offsetStartY: 0,
    offsetTime: 0,
    offsetDuration: 0,
    shake: 0
  };

  private sandbox: AutopilotSandbox = new AutopilotSandbox();
  public autopilotLog: (msg: string) => void = () => { };

  getCurrentDate(): Date {
    // Base J2000 epoch: Jan 1, 2000 12:00:00 UTC = 946728000000 ms
    const baseDate = 946728000000;
    return new Date(baseDate + (this.missionTime * this.secondsPerSimSecond * 1000));
  }

  jumpToDateAsync(targetDate: Date, precision: 'fast' | 'high' | 'ultra' = 'high', onProgress: (p: number) => void, onComplete: () => void) {
    const targetTimeMs = targetDate.getTime();
    const currentTimeMs = this.getCurrentDate().getTime();
    const diffMs = targetTimeMs - currentTimeMs;
    
    if (Math.abs(diffMs) < 1000) {
      onComplete();
      return;
    }

    const diffSimSeconds = (diffMs / 1000) / this.secondsPerSimSecond;
    const direction = Math.sign(diffSimSeconds);
    const totalSecondsToSimulate = Math.abs(diffSimSeconds);
    
    // Select step size based on precision
    let stepSize = 1000; // default (high)
    if (precision === 'fast') stepSize = 3600; // 1 hour steps
    if (precision === 'ultra') stepSize = 60;   // 1 minute steps (extremely precise)

    const stepDt = stepSize * direction; 
    const totalSteps = Math.ceil(totalSecondsToSimulate / Math.abs(stepDt));
    
    let currentStep = 0;
    const stepsPerChunk = 100000; 
    
    const originalPaused = this.paused;
    this.paused = true; 
    this.isJumping = true; 
    this.cancelJump = false;
    this.jumpProgress = 0;
    
    // Clear trails before jumping so we don't draw lines across the universe
    this.bodies.forEach(b => b.trail = []);

    const chunk = () => {
      const stepsToDo = Math.min(stepsPerChunk, totalSteps - currentStep);
      for (let i = 0; i < stepsToDo; i++) {
        this.stepPhysics(stepDt);
      }
      currentStep += stepsToDo;
      this.missionTime += (stepsToDo * stepDt);
      this.jumpProgress = currentStep / totalSteps;
      
      onProgress(this.jumpProgress);
      
      if (this.cancelJump) {
        this.paused = originalPaused;
        this.isJumping = false;
        this.jumpProgress = 0;
        onComplete();
        return;
      }
      
      if (currentStep < totalSteps) {
        setTimeout(chunk, 0); // Decouple from 60fps to calculate as fast as CPU allows
      } else {
        this.paused = originalPaused;
        this.isJumping = false;
        this.pendingJump = null;
        onComplete();
      }
    };
    
    this.pendingJump = () => setTimeout(chunk, 0);
  }

  startJump() {
    if (this.pendingJump) {
      this.pendingJump();
      this.pendingJump = null;
    }
  }

  getAltitude(): number {
    if (!this.vehicle) return 0;
    const dominant = this.getDominantBody(this.vehicle.position);
    if (!dominant) return 999999;
    const dx = this.vehicle.position.x - dominant.position.x;
    const dy = this.vehicle.position.y - dominant.position.y;
    return Math.sqrt(dx * dx + dy * dy) - dominant.radius;
  }

  getRelativeSpeed(): number {
    if (!this.vehicle) return 0;
    const dominant = this.getDominantBody(this.vehicle.position);
    if (!dominant) return 0;
    const relVx = this.vehicle.velocity.x - (dominant.velocity ? dominant.velocity.x : 0);
    const relVy = this.vehicle.velocity.y - (dominant.velocity ? dominant.velocity.y : 0);
    return Math.sqrt(relVx * relVx + relVy * relVy);
  }

  getRadialSpeed(): number {
    if (!this.vehicle) return 0;
    const dominant = this.getDominantBody(this.vehicle.position);
    if (!dominant) return 0;
    const dx = this.vehicle.position.x - dominant.position.x;
    const dy = this.vehicle.position.y - dominant.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const relVx = this.vehicle.velocity.x - (dominant.velocity ? dominant.velocity.x : 0);
    const relVy = this.vehicle.velocity.y - (dominant.velocity ? dominant.velocity.y : 0);
    // Dot product for radial component
    return (relVx * dx + relVy * dy) / dist;
  }

  getTangentialSpeed(): number {
    const total = this.getRelativeSpeed();
    const radial = this.getRadialSpeed();
    return Math.sqrt(Math.max(0, total * total - radial * radial));
  }

  startAutopilot(script: string, logCallback: (msg: string) => void) {
    this.autopilotLog = logCallback;
    this.missionTime = 0;
    
    this.sandbox.onCommand = (command: string, args: any[]) => {
      if (command === 'init_success') {
        this.isAutopilotActive = true;
        this.paused = false; // Ensure simulation unpauses when autopilot engages
        if (args[0] && this.targetLaunchTime === null) {
            this.targetLaunchTime = 0; // Auto-schedule for T-0 if script has onLaunch but didn't call setLaunchTime
        }
        return;
      }
      if (!this.vehicle) return;

      switch (command) {
        case 'setThrust':
          const amount = Math.max(0, Math.min(1, args[0]));
          (this.vehicle as any).thrustAmount = amount;
          (this.vehicle as any).thrusting = amount > 0.01;
          if (amount > 0.01) (this.vehicle as any).parentBodyId = null;
          break;
        case 'setRotate':
          const rot = Math.max(-1, Math.min(1, args[0]));
          (this.vehicle as any).rotationAmount = rot;
          (this.vehicle as any).rotatingLeft = rot < -0.01;
          (this.vehicle as any).rotatingRight = rot > 0.01;
          if (Math.abs(rot) > 0.01) (this.vehicle as any).parentBodyId = null;
          break;
        case 'setPitch':
          (this.vehicle as any).targetPitch = args[0];
          break;
        case 'setLaunchTime':
          this.targetLaunchTime = args[0];
          this.autopilotLog(`MISSION SCHEDULED: T-0 at T+${args[0]}s`);
          break;
        case 'speak':
          if (!('speechSynthesis' in window)) {
            if (args[2]) args[2]();
            return;
          }
          const utter = new SpeechSynthesisUtterance(String(args[0]));
          const options = args[1];
          utter.lang = options?.lang ?? 'en-US';
          
          // Dynamic Audio Effects based on simulation speed
          const baseRate = options?.rate ?? 1.0;
          const basePitch = options?.pitch ?? 1.0;
          const ts = Math.abs(this.timeScale);
          
          // Scale rate linearly, clamp to Web Speech API limits [0.1, 10]
          utter.rate = Math.max(0.1, Math.min(10, baseRate * ts));
          // Keep pitch constant as per user preference
          utter.pitch = basePitch;
          
          utter.volume = options?.volume ?? 1.0;
          if (args[2]) {
            utter.onend = () => args[2]();
            utter.onerror = () => args[2]();
          }
          const voices = window.speechSynthesis.getVoices();
          const preferred = voices.find(v => v.lang === (options?.lang ?? 'en-US'));
          if (preferred) utter.voice = preferred;
          window.speechSynthesis.speak(utter);
          break;
        case 'igniteBooster':
          this.activeBoosters.push({
            thrust: args[0],
            endTime: this.missionTime + args[1],
            cbId: args[2]
          } as any);
          this.autopilotLog(`BOOSTER IGNITION: ${(args[0] / 1e6).toFixed(1)} MN for ${args[1]}s`);
          break;
        case 'setCameraZoom':
          this.cinematicCamera.active = true;
          this.cinematicCamera.targetZoomScale = args[0];
          this.cinematicCamera.zoomStart = this.cinematicCamera.zoomScale > 0 ? this.cinematicCamera.zoomScale : args[0];
          this.cinematicCamera.zoomTime = 0;
          this.cinematicCamera.zoomDuration = args[1] || 0;
          if ((args[1] || 0) <= 0) this.cinematicCamera.zoomScale = args[0];
          break;
        case 'setCameraOffset':
          this.cinematicCamera.active = true;
          this.cinematicCamera.targetOffsetX = args[0];
          this.cinematicCamera.targetOffsetY = args[1];
          this.cinematicCamera.offsetStartX = this.cinematicCamera.offsetX;
          this.cinematicCamera.offsetStartY = this.cinematicCamera.offsetY;
          this.cinematicCamera.offsetTime = 0;
          this.cinematicCamera.offsetDuration = args[2] || 0;
          if ((args[2] || 0) <= 0) {
            this.cinematicCamera.offsetX = args[0];
            this.cinematicCamera.offsetY = args[1];
          }
          break;
        case 'setCameraShake':
          this.cinematicCamera.active = true;
          this.cinematicCamera.shake = args[0];
          break;
        case 'log':
          this.autopilotLog(args[0]);
          break;
      }
    };

    this.sandbox.onError = (err) => {
      this.autopilotLog(err);
      if (err.includes('Init Error') || err.includes('Compilation Error')) {
          this.stopAutopilot();
      }
    };

    try {
      this.sandbox.start(script);
    } catch (err: any) {
      this.autopilotLog("Sandbox Error: " + err.message);
    }
  }

  stopAutopilot() {
    this.isAutopilotActive = false;
    this.sandbox.stop();
    this.targetLaunchTime = null;
    this.launchEpoch = null;
    this.activeBoosters = [];
    this.cinematicCamera.active = false;
    this.cinematicCamera.shake = 0;
    this.cinematicCamera.offsetX = 0;
    this.cinematicCamera.offsetY = 0;
    this.cinematicCamera.zoomScale = -1;
    if (this.vehicle) {
      (this.vehicle as any).thrusting = false;
      (this.vehicle as any).rotatingLeft = false;
      (this.vehicle as any).rotatingRight = false;
    }
  }

  loadOrbitMission() {
    this.clear();
    this.timeScale = 1;
    this.G = 1.541e-6;
    this.paused = true; // Wait for user to hit engage

    const earthId = generateId();
    this.bodies.push({
      id: earthId, name: 'Earth', mass: 1.0, radius: 1.0, color: 'hsl(210, 80%, 60%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    });

    this.creationTemplate = { presetType: 'rocket' };
    const meta = this.getBodyMetadataFromPreset();
    const rocket = this.addBody(0, -(1.0 + meta.radius));
    if (rocket) {
      this.vehicle = rocket as any;
      (this.vehicle as any).parentBodyId = earthId;
      (this.vehicle as any).relativeOffset = { x: 0, y: -(1.0 + meta.radius) };
      (this.vehicle as any).rotation = -Math.PI / 2;
      this.camera.followingId = rocket.id;
      this.camera.zoom = 100;
    }

    this.currentScript = orbitScript;
  }

  loadArtemis2Mission() {
    this.clear();
    this.timeScale = 300;
    this.G = 1.541e-6;

    const earthId = generateId();
    this.bodies.push({
      id: earthId, name: 'Earth', mass: 1.0, radius: 1.0, color: 'hsl(210, 80%, 60%)',
      position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, trail: []
    });

    const mDist = 60; // Real-scale distance ~60 Earth radii
    const mV = Math.sqrt(this.G * 1.0 / mDist);
    this.bodies.push({
      id: generateId(), name: 'Moon', mass: 0.0123, radius: 0.273, color: 'hsl(0, 0%, 80%)',
      position: { x: mDist, y: 0 }, velocity: { x: 0, y: mV }, trail: []
    });

    // Deploy Rocket on Earth surface (North Pole for simplicity)
    this.creationTemplate = { presetType: 'rocket' };
    const meta = this.getBodyMetadataFromPreset();
    const rocket = this.addBody(0, -(1.0 + meta.radius));
    if (rocket) {
      this.vehicle = rocket as any;
      (this.vehicle as any).parentBodyId = earthId;
      (this.vehicle as any).relativeOffset = { x: 0, y: -(1.0 + meta.radius) };
      (this.vehicle as any).rotation = -Math.PI / 2;
      this.camera.followingId = rocket.id;
      this.camera.zoom = 100;
    }

    this.currentScript = `// Artemis 2 Mission Script
// Objective: Lunar Flyby and Return.

function autopilotStep(t, fc) {
    // Write your Artemis 2 logic here
}`;
  }

  loadRocketOnEarth() {
    this.clear();
    this.paused = true;
    this.G = 1.541e-6; // Realistic G for Earth=1.0 scale
    
    const earthId = generateId();
    const earthRadius = 1.0;
    this.bodies.push({
      id: earthId,
      name: 'Earth',
      mass: 1.0,
      radius: earthRadius,
      color: 'hsl(210, 80%, 60%)',
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      trail: []
    });

    this.creationTemplate = { presetType: 'rocket' };
    const meta = this.getBodyMetadataFromPreset();
    
    this.vehicle = {
      id: generateId(),
      name: 'Rocket',
      mass: meta.mass,
      radius: meta.radius,
      length: meta.length || meta.radius * 2,
      color: meta.color,
      position: { x: 0, y: -earthRadius - meta.radius },
      velocity: { x: 0, y: 0 },
      trail: [],
      type: 'rocket',
      rotation: -Math.PI / 2,
      angularVelocity: 0,
      isHeatProtected: false,
      thrustPower: meta.thrustPower || 0.05,
      maxKineticEnergy: meta.maxKineticEnergy || 50000
    };
    
    (this.vehicle as any).parentBodyId = earthId;
    (this.vehicle as any).relativeOffset = { x: 0, y: -earthRadius - meta.radius };
    this.bodies.push(this.vehicle);
    
    this.camera.followingId = this.vehicle.id;
    this.camera.zoom = 2000000; // Ultra-high zoom for realistic scale rocket visibility
  }

  loadBlackHoleDevour() {
    this.loadSolarSystem();
    const sun = this.bodies.find(b => b.name === 'Sun');
    if (sun) this.camera.followingId = sun.id;
    // Rogue black hole: ~1000 solar masses approaching the system
    const M_rogue = 333000000;
    const rs = (2 * this.G * M_rogue) / (this.C * this.C);
    this.bodies.push({
      id: generateId(), name: 'Rogue Void', mass: M_rogue, radius: Math.max(rs * 2.6, 50), color: '#000000',
      position: { x: 30000, y: 10000 }, velocity: { x: -0.01, y: -0.004 }, trail: [], isBlackHole: true
    });
    this.camera.zoom = 0.02;
  }

  update(dt: number) {
    if (!this.paused) {
      const rawDt = dt * this.timeScale;
      const safeDt = isNaN(rawDt) ? 0 : Math.min(rawDt, 0.1 * Math.max(1, this.timeScale));
      const desiredSubsteps = Math.ceil(Math.abs(safeDt) / 0.01);
      const substeps = isNaN(desiredSubsteps) ? 1 : Math.max(1, Math.min(200, desiredSubsteps));
      const stepDt = safeDt / substeps;

      for (let step = 0; step < substeps; step++) {
        if (!this.paused) {
          this.missionTime += stepDt;
        }
        this.stepPhysics(stepDt);
      }
      
      this.trailAccumulator += Math.abs(safeDt);
      if (this.trailAccumulator > 0.05 * Math.max(1, this.timeScale / 1000)) {
        this.updateTrails();
        this.trailAccumulator = 0;
      }
    }

    this.updateCameraFollow(dt);
    this.computeProjections();
  }

  updateTrails() {
    for (const b of this.bodies) {
      if (!b.trail) b.trail = [];
      b.trail.push({ ...b.position });
      if (b.trail.length > 300) b.trail.shift();
    }
  }

  stepPhysics(stepDt: number) {

        // Autopilot Execution
        if (this.isAutopilotActive) {
          if (!this.vehicle) {
            this.autopilotLog("Cannot communicate with ship.");
            this.stopAutopilot();
          } else {
          const METER_PER_UNIT = 6371000;
          const KG_PER_UNIT_MASS = 5.972e24;

          const formatBody = (b: Body) => {
            const dx = b.position.x - this.vehicle!.position.x;
            const dy = b.position.y - this.vehicle!.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return {
              id: b.id,
              name: b.name,
              mass: b.mass * KG_PER_UNIT_MASS,
              circumference: 2 * Math.PI * b.radius * METER_PER_UNIT,
              relativeX: dx * METER_PER_UNIT,
              relativeY: dy * METER_PER_UNIT,
              distance: dist * METER_PER_UNIT,
              angle: Math.atan2(dy, dx) * (180 / Math.PI)
            };
          };

          const dom = this.getDominantBody(this.vehicle.position);
          let gravitySim = 0;
          let horizonAngle = 0;
          let progradeAngle = 0;

          if (dom) {
            const dx = dom.position.x - this.vehicle.position.x;
            const dy = dom.position.y - this.vehicle.position.y;
            const distSq = dx * dx + dy * dy;
            gravitySim = (this.G * dom.mass) / Math.max(0.0001, distSq);
            horizonAngle = (Math.atan2(dy, dx) + Math.PI / 2) * (180 / Math.PI);
            
            const rvx = this.vehicle.velocity.x - dom.velocity.x;
            const rvy = this.vehicle.velocity.y - dom.velocity.y;
            progradeAngle = Math.atan2(rvy, rvx) * (180 / Math.PI);
          }

          const fcState = {
            thrust: (this.vehicle as any).thrusting ? 1.0 : 0.0,
            rotate: (this.vehicle as any).rotatingLeft ? -1.0 : ((this.vehicle as any).rotatingRight ? 1.0 : 0.0),
            rotation: this.vehicle.rotation * (180 / Math.PI),
            angularVelocity: this.vehicle.angularVelocity * (180 / Math.PI),
            altitude: this.getAltitude(),
            relativeSpeed: this.getRelativeSpeed(),
            radialSpeed: this.getRadialSpeed(),
            tangentialSpeed: this.getTangentialSpeed(),
            dominantBody: dom ? formatBody(dom) : null,
            vehicle: formatBody(this.vehicle),
            bodies: this.bodies.map(formatBody),
            gravityMagnitude: gravitySim / 1.541e-6,
            horizonAngle,
            progradeAngle,
            verticalSpeed: this.getRadialSpeed(),
            horizontalSpeed: this.getTangentialSpeed()
          };

          // Check if we've reached the scheduled launch time
          if (this.targetLaunchTime !== null && this.missionTime >= this.targetLaunchTime) {
            this.launchEpoch = this.missionTime; // Record exact T-0
            this.autopilotLog(`T-0! Launch sequence initiated at T+${this.missionTime.toFixed(1)}s`);
            this.sandbox.launch(fcState);
            this.targetLaunchTime = null; // fire once
          }
          
          this.sandbox.step(this.missionTime, fcState);
          }
        }

        // Vehicle controls
        if (this.vehicle) {
          const v = this.vehicle;
          // Apply angular momentum
          const torque = this.isAutopilotActive ? 5.0 : 5.0 / Math.max(1, this.timeScale);
          if (this.isAutopilotActive) {
            const rotAmount = (v as any).rotationAmount || 0;
            v.angularVelocity += rotAmount * torque * stepDt;
          } else {
            if ((v as any).rotatingLeft) v.angularVelocity -= torque * stepDt;
            if ((v as any).rotatingRight) v.angularVelocity += torque * stepDt;
          }

          // Friction: light damping for angular stability
          v.angularVelocity *= Math.pow(0.1, stepDt); 

          v.rotation += v.angularVelocity * stepDt;


          // Apply thrust
          let totalAcceleration = 0;
          if (this.isAutopilotActive) {
            const thrustAmount = (v as any).thrustAmount || 0;
            // Force a minimum capable thrust for Artemis/SLS to ensure it can SSTO
            const effectiveThrustPower = Math.max(v.thrustPower, 2.5e-6);
            totalAcceleration += thrustAmount * effectiveThrustPower;
          } else if ((v as any).thrusting) {
            totalAcceleration += v.thrustPower;
          }

          // Apply booster thrusts
          if (this.activeBoosters && this.activeBoosters.length > 0) {
            const METER_PER_UNIT = 6371000;
            const KG_PER_UNIT_MASS = 5.972e24;
            const vehicleMassKg = v.mass * KG_PER_UNIT_MASS;
            
            for (let i = this.activeBoosters.length - 1; i >= 0; i--) {
                const b = this.activeBoosters[i];
                if (this.missionTime >= b.endTime) {
                    if (b.cbId !== undefined && b.cbId !== null) {
                        this.sandbox.fireCallback(b.cbId);
                    }
                    this.activeBoosters.splice(i, 1);
                } else {
                    const a_meters = b.thrust / vehicleMassKg;
                    const a_sim = a_meters / METER_PER_UNIT;
                    totalAcceleration += a_sim;
                }
            }
          }

          if (totalAcceleration > 0) {
            if ((v as any).parentBodyId) {
              // BREAK FREE: Move a significant bit away from the surface to avoid immediate re-parenting by collision system
              const parent = this.bodies.find(b => b.id === (v as any).parentBodyId);
              if (parent) {
                const dx = v.position.x - parent.position.x;
                const dy = v.position.y - parent.position.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                // Nudge by 10% of rocket radius to ensure clear separation
                const nudgeDist = (v.radius || 0.0001) * 0.1;
                v.position.x += (dx / dist) * nudgeDist;
                v.position.y += (dy / dist) * nudgeDist;
              }
            }
            (v as any).parentBodyId = null;
            (v as any).isLaunchingOrThrusting = true;
            v.velocity.x += Math.cos(v.rotation) * totalAcceleration * stepDt;
            v.velocity.y += Math.sin(v.rotation) * totalAcceleration * stepDt;
          } else {
            (v as any).isLaunchingOrThrusting = false;
          }
        }

        // 1. Resolve Gravity & Forces (Global Frame for all bodies)
        for (let i = 0; i < this.bodies.length; i++) {
          const b1 = this.bodies[i];
          // If rocket is parented (landed), it inherits motion and skip physics
          if (this.vehicle && b1.id === this.vehicle.id && (this.vehicle as any).parentBodyId) continue;

          let ax = 0, ay = 0;
          for (let j = 0; j < this.bodies.length; j++) {
            if (i === j) continue;
            const b2 = this.bodies[j];
            const dx = b2.position.x - b1.position.x;
            const dy = b2.position.y - b1.position.y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);
            if (dist === 0) continue;
            const isB2BH = this.isBodyBlackHole(b2);
            const softening = Math.max(b1.radius, b2.radius);
            let potentialDist = Math.max(dist, softening * 0.1);
            if (isB2BH) potentialDist = Math.max(0.2, dist - b2.radius);
            const force = this.G * b2.mass / (potentialDist * potentialDist);
            ax += force * (dx / dist);
            ay += force * (dy / dist);
          }
          b1.velocity.x += ax * stepDt;
          b1.velocity.y += ay * stepDt;
          const speedSq = b1.velocity.x * b1.velocity.x + b1.velocity.y * b1.velocity.y;
          if (speedSq > this.C * this.C) {
            const speed = Math.sqrt(speedSq);
            b1.velocity.x = (b1.velocity.x / speed) * this.C;
            b1.velocity.y = (b1.velocity.y / speed) * this.C;
          }
        }
        for (let i = 0; i < this.bodies.length; i++) {
          const b1 = this.bodies[i];

          // Position Update
          if (this.vehicle && b1.id === this.vehicle.id && (this.vehicle as any).parentBodyId) {
            const parent = this.bodies.find(b => b.id === (this.vehicle as any).parentBodyId);
            if (parent) {
              b1.position.x = parent.position.x + (this.vehicle as any).relativeOffset.x;
              b1.position.y = parent.position.y + (this.vehicle as any).relativeOffset.y;
              b1.velocity.x = parent.velocity.x;
              b1.velocity.y = parent.velocity.y;
            } else {
              (this.vehicle as any).parentBodyId = null;
              b1.position.x += b1.velocity.x * stepDt;
              b1.position.y += b1.velocity.y * stepDt;
            }
          } else {
            b1.position.x += b1.velocity.x * stepDt;
            b1.position.y += b1.velocity.y * stepDt;
          }


          if (this.isBodyBlackHole(b1)) {
            const rs = (2 * this.G * Math.abs(b1.mass)) / (this.C * this.C);
            b1.radius = rs * 2.6;
            b1.isBlackHole = true;
          }
        }
        for (let i = 0; i < this.bodies.length; i++) {
          const b1 = this.bodies[i];
          if (b1.mass === 0) continue;
          for (let j = i + 1; j < this.bodies.length; j++) {
            const b2 = this.bodies[j];
            if (b2.mass === 0) continue;
            const dx = b2.position.x - b1.position.x;
            const dy = b2.position.y - b1.position.y;
            const distSq = dx * dx + dy * dy;
            const isB1BH = this.isBodyBlackHole(b1);
            const isB2BH = this.isBodyBlackHole(b2);
            let captureRadius = b1.radius + b2.radius;
            if (isB1BH) captureRadius = b1.radius * 0.99;
            if (isB2BH) captureRadius = isB1BH ? Math.min(captureRadius, b2.radius * 0.99) : b2.radius * 0.99;
            if (distSq < captureRadius * captureRadius) {
              const bigger = b1.mass >= b2.mass ? b1 : b2;
              const smaller = b1.mass >= b2.mass ? b2 : b1;

              // Check if vehicle is involved in collision
              if (this.vehicle && (b1.id === this.vehicle.id || b2.id === this.vehicle.id)) {
                const vehicleBody = b1.id === this.vehicle.id ? b1 : b2;
                const other = b1.id === this.vehicle.id ? b2 : b1;

                if ((vehicleBody as any).parentBodyId === other.id) continue;

                // If it's a black hole or extreme star, destroy rocket
                if (this.isBodyBlackHole(other) || other.mass > 1000000) {
                  vehicleBody.mass = 0;
                  this.vehicle = null;
                  break;
                } else {
                  // Calculate relative speed for impact damage
                  const relVx = vehicleBody.velocity.x - other.velocity.x;
                  const relVy = vehicleBody.velocity.y - other.velocity.y;
                  const relSpeedSq = relVx * relVx + relVy * relVy;

                  if ((vehicleBody as any).isLaunchingOrThrusting) {
                    // Launching: only depenetrate if sinking in, otherwise fly free
                    const angle = Math.atan2(vehicleBody.position.y - other.position.y, vehicleBody.position.x - other.position.x);
                    const nx = Math.cos(angle), ny = Math.sin(angle);
                    const relVx = vehicleBody.velocity.x - other.velocity.x;
                    const relVy = vehicleBody.velocity.y - other.velocity.y;
                    const inward = relVx * nx + relVy * ny;
                    if (inward < 0) {
                      // Still sinking: push out and cancel inward velocity
                      const surfaceDist = other.radius + vehicleBody.radius;
                      vehicleBody.position.x = other.position.x + nx * surfaceDist;
                      vehicleBody.position.y = other.position.y + ny * surfaceDist;
                      vehicleBody.velocity.x -= inward * nx;
                      vehicleBody.velocity.y -= inward * ny;
                    }
                    continue; // Never merge/crash while thrusting
                  } else if (relSpeedSq < 1e-6 && !(vehicleBody as any).isLaunchingOrThrusting) {
                    // Gentle landing: bind to surface
                    const v = vehicleBody as any;
                    v.parentBodyId = other.id;
                    v.velocity.x = other.velocity.x;
                    v.velocity.y = other.velocity.y;
                    const angle = Math.atan2(vehicleBody.position.y - other.position.y, vehicleBody.position.x - other.position.x);
                    v.rotation = angle; // Align to surface
                    v.position.x = other.position.x + Math.cos(angle) * (other.radius + vehicleBody.radius);
                    v.position.y = other.position.y + Math.sin(angle) * (other.radius + vehicleBody.radius);
                    v.relativeOffset = {
                      x: v.position.x - other.position.x,
                      y: v.position.y - other.position.y
                    };
                    continue; // Don't merge
                  } else {
                    // High impact crash
                    vehicleBody.mass = 0;
                    this.vehicle = null;
                    break;
                  }
                }
              }

              const totalMass = bigger.mass + smaller.mass;
              bigger.velocity.x = (bigger.mass * bigger.velocity.x + smaller.mass * smaller.velocity.x) / totalMass;
              bigger.velocity.y = (bigger.mass * bigger.velocity.y + smaller.mass * smaller.velocity.y) / totalMass;
              bigger.position.x = (bigger.mass * bigger.position.x + smaller.mass * smaller.position.x) / totalMass;
              bigger.position.y = (bigger.mass * bigger.position.y + smaller.mass * smaller.position.y) / totalMass;
              const newRadius = Math.sqrt(bigger.radius * bigger.radius + smaller.radius * smaller.radius);
              bigger.mass = totalMass;
              if (!this.isBodyBlackHole(bigger)) bigger.radius = newRadius;
              else {
                const rs = (2 * this.G * bigger.mass) / (this.C * this.C);
                bigger.radius = rs * 2.6;
              }
              smaller.mass = 0;
              if (this.camera.followingId === smaller.id) this.camera.followingId = bigger.id;
              if (b1.mass === 0) break;
            }
          }
        }
        this.bodies = this.bodies.filter(b => b.mass > 0);
  }

  computeProjections() {
    const targetId = this.camera.followingId || this.selectedBodyId;
    // Clear all projected trails first
    for (const b of this.bodies) {
      b.projectedTrail = undefined;
      (b as any).projectedTrailReferenceId = undefined;
    }

    if (!targetId) return;
    const body = this.bodies.find(b => b.id === targetId);
    if (!body || body.mass === 0) return;

    const influencers = this.bodies
      .filter(b => b.mass > 0.001 || this.isBodyBlackHole(b))
      .map(b => ({
        id: b.id,
        mass: b.mass,
        radius: b.radius,
        position: { ...b.position },
        velocity: { ...b.velocity },
        isBlackHole: this.isBodyBlackHole(b)
      }));

    const targetIdx = influencers.findIndex(b => b.id === targetId);
    let target: any;

    if (targetIdx === -1) {
      target = {
        id: body.id,
        mass: body.mass,
        radius: body.radius,
        position: { ...body.position },
        velocity: { ...body.velocity },
        isBlackHole: this.isBodyBlackHole(body)
      };
      influencers.push(target);
    } else {
      target = influencers[targetIdx];
    }

    const dominantStart = this.getDominantBody(target.position);
    if (dominantStart) {
      (body as any).projectedTrailReferenceId = dominantStart.id;
    }

    const projection: Vector2[] = [];
    const projectionSteps = 240;
    const projectionSubsteps = 4;
    // Adapt projection speed to timeScale
    const stepDt = 0.05 * Math.max(1, this.timeScale);

    for (let i = 0; i < projectionSteps; i++) {
      for (let s = 0; s < projectionSubsteps; s++) {
        for (const b1 of influencers) {
          let ax = 0, ay = 0;
          for (const b2 of influencers) {
            if (b1.id === b2.id) continue;
            const dx = b2.position.x - b1.position.x;
            const dy = b2.position.y - b1.position.y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);
            if (dist < 1e-12) continue;

            const softening = Math.max(b1.radius, b2.radius) * 0.1;
            const potentialDist = Math.max(dist, softening);
            const force = this.G * b2.mass / (potentialDist * potentialDist);
            ax += force * (dx / dist);
            ay += force * (dy / dist);
          }
          b1.velocity.x += ax * stepDt;
          b1.velocity.y += ay * stepDt;
        }

        for (const b1 of influencers) {
          b1.position.x += b1.velocity.x * stepDt;
          b1.position.y += b1.velocity.y * stepDt;
        }
      }

      if (dominantStart) {
        const domInSim = influencers.find(inf => inf.id === dominantStart.id);
        if (domInSim) {
          projection.push({
            x: target.position.x - domInSim.position.x,
            y: target.position.y - domInSim.position.y
          });
        } else {
          projection.push({ x: target.position.x, y: target.position.y });
        }
      } else {
        projection.push({ x: target.position.x, y: target.position.y });
      }

      // Collision check
      let collided = false;
      for (const other of influencers) {
        if (other.id === target.id) continue;
        const dx = other.position.x - target.position.x;
        const dy = other.position.y - target.position.y;
        if (dx * dx + dy * dy < (target.radius + other.radius) ** 2) {
          collided = true;
          break;
        }
      }
      if (collided) break;
    }
    body.projectedTrail = projection;
  }

  updateCameraFollow(dt: number) {
    if (this.cinematicCamera.active) {
      if (this.cinematicCamera.zoomDuration > 0 && this.cinematicCamera.zoomTime < this.cinematicCamera.zoomDuration) {
        this.cinematicCamera.zoomTime += dt;
        const t = Math.min(1, this.cinematicCamera.zoomTime / this.cinematicCamera.zoomDuration);
        const easeOut = 1 - Math.pow(1 - t, 3);
        this.cinematicCamera.zoomScale = this.cinematicCamera.zoomStart + (this.cinematicCamera.targetZoomScale - this.cinematicCamera.zoomStart) * easeOut;
      }
      
      if (this.cinematicCamera.offsetDuration > 0 && this.cinematicCamera.offsetTime < this.cinematicCamera.offsetDuration) {
        this.cinematicCamera.offsetTime += dt;
        const t = Math.min(1, this.cinematicCamera.offsetTime / this.cinematicCamera.offsetDuration);
        const easeOut = 1 - Math.pow(1 - t, 3);
        this.cinematicCamera.offsetX = this.cinematicCamera.offsetStartX + (this.cinematicCamera.targetOffsetX - this.cinematicCamera.offsetStartX) * easeOut;
        this.cinematicCamera.offsetY = this.cinematicCamera.offsetStartY + (this.cinematicCamera.targetOffsetY - this.cinematicCamera.offsetStartY) * easeOut;
      }
    }

    if (this.camera.followingId !== this.lastFollowId) {
      this.lastFollowId = this.camera.followingId;
      this.camTransition = 0;
      this.camStartX = this.camera.x;
      this.camStartY = this.camera.y;
    }
    if (this.camera.followingId) {
      const target = this.bodies.find(b => b.id === this.camera.followingId);
      if (target) {
        if (this.camTransition < 1) {
          const transitionSpeed = 2.0;
          this.camTransition += dt * transitionSpeed;
          if (this.camTransition > 1) this.camTransition = 1;
          const t = this.camTransition;
          const easeOut = 1 - Math.pow(1 - t, 3);
          this.camera.x = this.camStartX + (target.position.x - this.camStartX) * easeOut;
          this.camera.y = this.camStartY + (target.position.y - this.camStartY) * easeOut;
        } else {
          this.camera.x = target.position.x;
          this.camera.y = target.position.y;
        }
      } else {
        this.camera.followingId = null;
        this.lastFollowId = null;
      }
    }
  }

  screenToWorld(sx: number, sy: number, canvasWidth: number, canvasHeight: number): Vector2 {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    return {
      x: (sx - cx) / this.camera.zoom + this.camera.x,
      y: (sy - cy) / this.camera.zoom + this.camera.y
    };
  }

  worldToScreen(wx: number, wy: number, canvasWidth: number, canvasHeight: number): Vector2 {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    return {
      x: (wx - this.camera.x) * this.camera.zoom + cx,
      y: (wy - this.camera.y) * this.camera.zoom + cy
    };
  }
}

export function generateId() {
  return Math.random().toString(36).substring(2, 9);
}
