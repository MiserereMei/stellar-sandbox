# Stellar Sandbox: Flight Control API

The Flight Control (fc) interface allows you to write JavaScript autopilot scripts to control your spacecraft. The system uses real-world physics integration and provides sensor data in both simulation units and SI units.

## Actuators (Setters)

| Method | Description | Range |
| :--- | :--- | :--- |
| `fc.setThrust(v)` | Sets the engine throttle. Automatically breaks planetary docking. | `0.0` to `1.0` |
| `fc.setRotate(v)` | Sets rotation torque. Negative for Left, Positive for Right. | `-1.0` to `1.0` |

## Sensors (Getters)

| Method | Description | Units |
| :--- | :--- | :--- |
| `fc.getThrust()` | Returns the current throttle setting. | `0.0 - 1.0` |
| `fc.getRotate()` | Returns the current rotation command. | `-1.0 / 0 / 1.0` |
| `fc.getRotation()` | Returns the ship's current rotation angle. | Degrees |
| `fc.getAngularVelocity()`| Returns the ship's current spin rate. | Deg/sec |
| `fc.getAltitude()` | Returns altitude above the dominant body's surface. | Sim Units |
| `fc.getRelativeSpeed()` | Returns absolute speed relative to the dominant body. | Sim Units |
| `fc.getRadialSpeed()` | Returns vertical speed (positive = climbing). | Sim Units |
| `fc.getTangentialSpeed()`| Returns horizontal (orbital) speed. | Sim Units |

## Celestial Navigation (SI Units)

These methods return rich data about planets and moons in Standard International (SI) units.

### fc.getDominantBody()
Returns the celestial body that has the strongest gravitational pull on the ship.

### fc.getBodyById(id)
Returns a specific celestial body by its unique ID.

### fc.getVehicle()
Returns the ship's own physical data (mass, name, etc.) as a CelestialBody object.

### CelestialBody Object Properties
All properties are in real-world units (meters, kilograms).

```typescript
interface CelestialBody {
  id: string;              // Unique identifier
  name: string;            // e.g., "Earth", "Moon"
  mass: number;            // Kilograms (kg)
  circumference: number;   // Surface circumference (meters)
  relativeX: number;       // X-distance from ship (meters)
  relativeY: number;       // Y-distance from ship (meters)
  distance: number;        // Absolute distance from ship (meters)
  angle: number;           // Angle from ship to body (degrees)
}
```

## Lifecycle Events

The system uses a single primary event listener for flight logic.

| Event | Callback Signature | Description |
| :--- | :--- | :--- |
| `"step"` | `(t, fc) => {}` | Fires every physics frame (~60Hz). This is where all sensors are read and actuators are set. |

### Example
```javascript
fc.on("step", (t, fc) => {
    // 1. Read Sensors
    const alt = fc.getAltitude();
    
    // 2. Logic
    if (alt > 0.1) fc.setThrust(1.0);
    
    // 3. Actuators
    fc.setRotate(0.1);
});
```

## Mission Control & UI

| Method | Description | Units |
| :--- | :--- | :--- |
| `fc.setLaunchTime(seconds)` | Schedules a UI countdown (T-minus). Does NOT trigger an event; use `t` in the step loop to sync your logic. | Seconds |
| `fc.igniteBooster(thrust, burnTime, onBurnout)` | Fires solid rocket boosters (SRBs) adding raw physical force. `onBurnout(fc)` is triggered when fuel runs out. | Newtons, Seconds |

## Cinematic Camera (Streaming Mode)

*These functions only affect the viewport when Streaming Mode (Ctrl+Shift+S) is active.*

| Method | Description | Units |
| :--- | :--- | :--- |
| `fc.setCameraZoom(scale, smoothTime?)` | Changes the camera zoom to make the tracked object fill the given fraction of the screen. | `scale`: 0.0 to 1.0 (screen fraction), `smoothTime`: Seconds |
| `fc.setCameraOffset(x, y, smoothTime?)` | Offsets the camera focus point to add lead-room for ascent/descent. | `x`, `y`: -1.0 to 1.0 (screen percentage), `smoothTime`: Seconds |
| `fc.setCameraShake(intensity)` | Shakes the viewport to simulate engine vibration or atmospheric friction. | `intensity`: 0.0 (off) to 1.0 (violent) |

## Utility

| Method | Description |
| :--- | :--- |
| `fc.log(message)` | Prints a timestamped message to the Telemetry Log in the UI. |
| `fc.speak(text, options?)` | Speaks text aloud using the browser's Web Speech API. Returns a `Promise` that resolves when speech finishes. |

### Text-to-Speech (Awaitable)

You can use top-level `await` to chain speech commands sequentially before other logic executes.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `text` | string | — | Text to speak |
| `options.lang` | string | `"en-US"` | BCP 47 language tag |
| `options.rate` | number | `1.0` | Speed (0.1 – 10) |
| `options.pitch` | number | `1.0` | Pitch (0 – 2) |
| `options.volume` | number | `1.0` | Volume (0 – 1) |

```javascript
// Top-level await is fully supported!
await fc.speak("Welcome to flight control.");
await fc.speak("Initiating pre-flight sequence.", { rate: 0.9, pitch: 0.8 });
fc.log("Audio sequence complete.");
```

---

## Example: Auto-Orbit Logic
```javascript
fc.setLaunchTime(10); // Start 10s UI countdown

// You can await speech commands!
await fc.speak("Flight systems engaged.");
await fc.speak("Standing by for launch.");

let ignited = false;

fc.on("step", (t, fc) => {
    // Wait for countdown
    if (t < 10) return;

    // Trigger ignition once
    if (!ignited) {
        fc.igniteBooster(32000000, 120);
        ignited = true;
    }

    // Flight control...
    fc.setThrust(1.0);
});
```
