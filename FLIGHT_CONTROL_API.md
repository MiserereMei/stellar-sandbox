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

## Mission Control & Sequencing

| Method | Description | Units |
| :--- | :--- | :--- |
| `fc.setLaunchTime(startTime)` | Schedules a T-0 launch sequence. HUD counts down and calls `onLaunch(fc)` exactly at T-0. | Seconds |
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

---

## Example: Basic Orbit Stabilization
```javascript
function autopilotStep(t, fc) {
    const alt = fc.getAltitude();
    const vOrbital = Math.sqrt(2.442e-7 / (1.0 + alt));
    const tSpeed = fc.getTangentialSpeed();

    if (alt > 0.15 && tSpeed < vOrbital) {
        fc.setThrust(1.0);
        fc.log("Correcting orbital velocity...");
    } else {
        fc.setThrust(0);
    }
}
```

## Text-to-Speech

### fc.speak(text, options?)
Speaks text aloud using the browser's Web Speech API.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `text` | string | — | Text to speak |
| `options.lang` | string | `"en-US"` | BCP 47 language tag |
| `options.rate` | number | `1.0` | Speed (0.1 – 10) |
| `options.pitch` | number | `1.0` | Pitch (0 – 2) |
| `options.volume` | number | `1.0` | Volume (0 – 1) |

```javascript
fc.speak("Booster separation in 3 seconds.");
fc.speak(`Altitude: ${Math.round(alt * 6371)} kilometers.`);
fc.speak("Orbital insertion complete.", { rate: 0.9, pitch: 0.8 });
```
