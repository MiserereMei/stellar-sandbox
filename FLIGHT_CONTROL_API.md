# Stellar Sandbox: Flight Control API

The Flight Control (fc) interface allows you to write JavaScript autopilot scripts to control your spacecraft. The system uses real-world physics integration and provides sensor data in both simulation units and SI units.

## Table of Contents
- [Lifecycle Events](#lifecycle-events)
- [Sensors (Getters)](#sensors-getters)
- [Actuators (Setters)](#actuators-setters)
- [Celestial Navigation (SI Units)](#celestial-navigation-si-units)
- [Assisted Flight (fc.essentials)](#assisted-flight-fcessentials)
- [Cinematic Camera (fc.camera)](#cinematic-camera-fccamera)
- [Utility](#utility)

---

## Lifecycle Events

The system uses an event-driven architecture to manage flight logic.

| Event | Callback Signature | Description |
| :--- | :--- | :--- |
| `"step"` | `(t, fc) => {}` | Fires every physics frame (~60Hz). This is where all sensors are read and actuators are set. |
| `"launch"`| `(fc) => {}` | Fires exactly at T-0 once a launch is scheduled. Useful for ignition or one-time events. |

### Basic Template
```javascript
fc.on("step", (t, fc) => {
    // Read Sensors
    const alt = fc.getAltitude();
    
    // Flight Logic
    if (alt < 0.1) fc.setThrust(1.0);
    
    // Control Actuators
    fc.setRotate(0.1);
});

fc.on("launch", async (fc) => {
    await fc.speak("Liftoff confirmed!");
    fc.igniteBooster(10000, 10);
});
```

## Sensors (Getters)

These methods return the current state of your vehicle relative to the dominant gravitational body.

| Method | Description | Units |
| :--- | :--- | :--- |
| `fc.getAltitude()` | Returns altitude above the surface. | Sim Units |
| `fc.getRelativeSpeed()` | Returns absolute speed relative to the planet. | Sim Units |
| `fc.getRadialSpeed()` | Returns vertical speed (positive = climbing). | Sim Units |
| `fc.getTangentialSpeed()`| Returns horizontal (orbital) speed. | Sim Units |
| `fc.getVerticalSpeed()` | Returns vertical speed relative to surface. | Sim Units |
| `fc.getHorizontalSpeed()`| Returns horizontal speed relative to surface. | Sim Units |
| `fc.getRotation()` | Returns the ship's current rotation angle. | Degrees |
| `fc.getAngularVelocity()`| Returns the ship's current spin rate. | Deg/sec |
| `fc.getThrust()` | Returns the current throttle setting. | `0.0 - 1.0` |
| `fc.getRotate()` | Returns the current rotation command. | `-1.0 / 0 / 1.0` |

## Actuators (Setters)

Directly control the hardware of your spacecraft.

| Method | Description | Range |
| :--- | :--- | :--- |
| `fc.setThrust(v)` | Sets the engine throttle. Automatically breaks planetary docking. | `0.0` to `1.0` |
| `fc.setRotate(v)` | Sets rotation torque. Negative for Left, Positive for Right. | `-1.0` to `1.0` |
| `fc.igniteBooster(thrust, burnTime, onBurnout?)` | Fires solid rocket boosters (SRBs). | Newtons, Seconds |

## Celestial Navigation (SI Units)

These methods return rich data about planets and moons in Standard International (SI) units.

### fc.getDominantBody()
Returns the celestial body that has the strongest gravitational pull on the ship.

### fc.getBodyById(id)
Returns a specific celestial body by its unique ID.

### fc.getBodies()
Returns an array of all celestial bodies currently in the simulation.

### fc.getVehicle()
Returns the ship's own physical data (mass, name, etc.) as a CelestialBody object.

#### CelestialBody Object Properties
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

## Assisted Flight (fc.essentials)

High-level helpers that handle complex math and stabilization automatically.

| Method | Description | Range |
| :--- | :--- | :--- |
| `fc.essentials.setPitch(deg)` | Sets a target pitch angle (relative to horizon) for auto-alignment. | `0` to `360` |
| `fc.essentials.setLaunchTime(s)` | Schedules a T-minus countdown and triggers `"launch"` event. | Seconds |

## Cinematic Camera (fc.camera)

*These functions only affect the viewport when Streaming Mode (Ctrl+Shift+S) is active.*

| Method | Description | Range |
| :--- | :--- | :--- |
| `fc.camera.setZoom(v)` | Automated cinematic camera zoom. | `0.0 - 1.0` |
| `fc.camera.setOffset(x, y)` | Offsets camera focus point. | `-1.0 to 1.0` |
| `fc.camera.setShake(v)` | Viewport vibration intensity. | `0.0 - 1.0` |

## Utility

| Method | Description |
| :--- | :--- |
| `fc.log(message)` | Prints a message to the Telemetry Log in the UI. |
| `fc.speak(text, options?)` | Speaks text aloud using the browser's Web Speech API. |

### Text-to-Speech Options
| Parameter | Type | Default | Description |
|---|---|---|---|
| `text` | string | — | Text to speak |
| `options.lang` | string | `"en-US"` | BCP 47 language tag |
| `options.rate` | number | `1.0` | Speed (0.1 – 10) |
| `options.pitch` | number | `1.0` | Pitch (0 – 2) |
| `options.volume` | number | `1.0` | Volume (0 – 1) |
