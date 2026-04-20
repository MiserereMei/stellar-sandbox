# Stellar Sandbox

Stellar Sandbox is a high-fidelity 2D physics sandbox for planetary mechanics, orbital trajectories, and automated spaceflight.

## Features
- **N-Body Gravity**: Realistic gravitational simulation for stars, planets, and moons.
- **Relativistic Warp**: Spacetime curvature visual effects (Lensing) around massive bodies.
- **Autopilot System**: Scriptable flight control using JavaScript to automate complex missions.
- **Real-Scale Navigation**: Support for SI units (meters, kilograms) in mission scripting.

## Flight Control API
You can automate your spacecraft using the integrated Autopilot Terminal.  
See the full documentation here: **[FLIGHT_CONTROL_API.md](./FLIGHT_CONTROL_API.md)**

## Run Locally

**Prerequisites:** Node.js (v18+)

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Set API Key:**
   Set your `GEMINI_API_KEY` in `.env.local` to enable AI system generation features.
3. **Start Sandbox:**
   ```bash
   npm run dev
   ```