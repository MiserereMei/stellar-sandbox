export class AutopilotSandbox {
  private scriptFn: any = null;
  private sandboxProxy: any = null;

  public onCommand: (command: string, args: any[]) => void = () => {};
  public onError: (err: string) => void = () => {};

  start(script: string) {
    this.stop();

    try {
      // Create a dedicated flight control (fc) instance for this sandbox
      const fc = {
        _state: {} as any,
        getThrust: () => fc._state.thrust,
        getRotate: () => fc._state.rotate,
        getRotation: () => fc._state.rotation,
        getAngularVelocity: () => fc._state.angularVelocity,
        getAltitude: () => fc._state.altitude,
        getRelativeSpeed: () => fc._state.relativeSpeed,
        getRadialSpeed: () => fc._state.radialSpeed,
        getTangentialSpeed: () => fc._state.tangentialSpeed,
        getDominantBody: () => fc._state.dominantBody,
        getVehicle: () => fc._state.vehicle,
        getBodyById: (id: string) => fc._state.bodies?.find((b: any) => b.id === id) || null,
        getGravityMagnitude: () => fc._state.gravityMagnitude,
        getHorizonAngle: () => fc._state.horizonAngle,
        getProgradeAngle: () => fc._state.progradeAngle,
        getVerticalSpeed: () => fc._state.verticalSpeed,
        getHorizontalSpeed: () => fc._state.horizontalSpeed,

        setThrust: (amount: number) => this.onCommand('setThrust', [amount]),
        setRotate: (amount: number) => this.onCommand('setRotate', [amount]),
        setPitch: (amount: number) => this.onCommand('setPitch', [amount]),
        setLaunchTime: (time: number) => this.onCommand('setLaunchTime', [time]),
        setLaunchSchedule: (time: number) => this.onCommand('setLaunchTime', [time]),
        speak: (text: string, options: any) => this.onCommand('speak', [text, options]),
        igniteBooster: (thrust: number, time: number, cb: () => void) => {
            this.onCommand('igniteBooster', [thrust, time, cb]);
        },
        setCameraZoom: (scale: number, smoothTime: number) => this.onCommand('setCameraZoom', [scale, smoothTime]),
        setCameraOffset: (x: number, y: number, smoothTime: number) => this.onCommand('setCameraOffset', [x, y, smoothTime]),
        setCameraShake: (intensity: number) => this.onCommand('setCameraShake', [intensity]),
        log: (msg: string) => this.onCommand('log', [msg])
      };

      // Security: Create a restricted global scope for the script
      const context = {
        fc,
        Math,
        Date,
        JSON,
        Object,
        Array,
        Number,
        String,
        Boolean,
        Error,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console: {
          log: (...args: any[]) => this.onCommand('log', [args.join(' ')]),
          error: (...args: any[]) => this.onCommand('log', ['ERROR: ' + args.join(' ')]),
        }
      };

      // Evaluation in a restricted scope
      this.scriptFn = new Function('context', `
        with(context) {
          ${script}
          return {
            autopilotStep: typeof autopilotStep !== 'undefined' ? autopilotStep : null,
            onLaunch: typeof onLaunch !== 'undefined' ? onLaunch : null
          };
        }
      `);

      const result = this.scriptFn(context);
      this.sandboxProxy = {
          fc,
          autopilotStep: result.autopilotStep,
          onLaunch: result.onLaunch
      };

      this.onCommand('init_success', [!!result.onLaunch]);
    } catch (err: any) {
      this.onError('Init Error: ' + err.message);
    }
  }

  step(missionTime: number, state: any) {
    if (!this.sandboxProxy || !this.sandboxProxy.autopilotStep) return;
    this.sandboxProxy.fc._state = state;
    try {
      this.sandboxProxy.autopilotStep(missionTime, this.sandboxProxy.fc);
    } catch (err: any) {
      this.onError('Runtime Error: ' + err.message);
      this.stop();
    }
  }

  launch(state: any) {
    if (!this.sandboxProxy || !this.sandboxProxy.onLaunch) return;
    this.sandboxProxy.fc._state = state;
    try {
      this.sandboxProxy.onLaunch(this.sandboxProxy.fc);
    } catch (err: any) {
      this.onError('onLaunch Error: ' + err.message);
    }
  }

  fireCallback(cb: any) {
    if (typeof cb === 'function') {
        try { cb(); } catch(err: any) { this.onError('Callback Error: ' + err.message); }
    }
  }

  stop() {
    this.scriptFn = null;
    this.sandboxProxy = null;
  }
}

