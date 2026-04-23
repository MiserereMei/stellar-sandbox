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
        _events: {} as Record<string, Function[]>,
        on: (event: string, cb: Function) => {
          if (!fc._events[event]) fc._events[event] = [];
          fc._events[event].push(cb);
        },
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
        speak: (text: string, options: any) => {
          return new Promise(resolve => {
            this.onCommand('speak', [text, options, resolve]);
          });
        },
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
        Promise, // Expose Promise for async/await
        console: {
          log: (...args: any[]) => this.onCommand('log', [args.join(' ')]),
          error: (...args: any[]) => this.onCommand('log', ['ERROR: ' + args.join(' ')]),
        }
      };

      // Evaluation in a restricted scope using AsyncFunction to support top-level await
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      this.scriptFn = new AsyncFunction('context', `
        with(context) {
          ${script}
          // Support both fc.on and global functions
          if (typeof autopilotStep !== 'undefined') fc.on('step', autopilotStep);
          if (typeof onLaunch !== 'undefined') fc.on('launch', onLaunch);
        }
      `);

      this.scriptFn(context).catch((err: any) => {
        this.onError('Async Runtime Error: ' + err.message);
      });
      
      this.sandboxProxy = { fc };

      this.onCommand('init_success', [!!(fc._events['launch']?.length)]);
    } catch (err: any) {
      this.onError('Init Error: ' + err.message);
    }
  }

  step(missionTime: number, state: any) {
    if (!this.sandboxProxy) return;
    this.sandboxProxy.fc._state = state;
    const listeners = this.sandboxProxy.fc._events['step'] || [];
    for (const cb of listeners) {
      try {
        cb(missionTime, this.sandboxProxy.fc);
      } catch (err: any) {
        this.onError('Runtime Error: ' + err.message);
        this.stop();
        break;
      }
    }
  }

  launch(state: any) {
    if (!this.sandboxProxy) return;
    this.sandboxProxy.fc._state = state;
    const listeners = this.sandboxProxy.fc._events['launch'] || [];
    for (const cb of listeners) {
      try {
        cb(this.sandboxProxy.fc);
      } catch (err: any) {
        this.onError('onLaunch Error: ' + err.message);
      }
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

