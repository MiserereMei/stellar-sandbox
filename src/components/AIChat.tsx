import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { Simulation, generateId } from '../lib/Simulation';
import { Sparkles, Loader2, Send, ChevronDown, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import FC_API_DOC from '../../FLIGHT_CONTROL_API.md?raw';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  text?: string;       // only shown when AI explicitly speaks
  toolCalls?: string[]; // tool names executed (for subtle indicators)
  thought?: string;    // internal reasoning (only for supported models)
  isError?: boolean;   // flag for error messages
}

interface AIChatProps {
  sim: Simulation;
  show: boolean;
  onClose: () => void;
  anchorRect?: { left: number; top: number; side?: 'left' | 'right' };
  apiKey: string;
  onSetApiKey?: (key: string) => void;
}

// ─── Tool Definitions (MCP-style) ────────────────────────────────────────────

const TOOLS = [
  {
    name: 'replace_all_bodies',
    description: 'Replaces the entire simulation with a new set of celestial bodies. Use for "create a solar system", "build a binary star", etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        bodies: {
          type: Type.ARRAY,
          description: 'Full list of bodies to populate the simulation with.',
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              mass: { type: Type.NUMBER },
              radius: { type: Type.NUMBER },
              color: { type: Type.STRING },
              position: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } } },
              velocity: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } } },
            },
            required: ['id', 'name', 'mass', 'radius', 'color', 'position', 'velocity'],
          },
        },
        G: { type: Type.NUMBER, description: 'Optional: override gravitational constant. Default: 1.541e-6.' },
      },
      required: ['bodies'],
    },
  },
  {
    name: 'add_body',
    description: 'Adds a single new celestial body to the existing simulation without disturbing other bodies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        mass: { type: Type.NUMBER },
        radius: { type: Type.NUMBER },
        color: { type: Type.STRING },
        position: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } } },
        velocity: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } } },
      },
      required: ['name', 'mass', 'radius', 'color', 'position', 'velocity'],
    },
  },
  {
    name: 'remove_body',
    description: 'Removes a celestial body from the simulation by name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Exact name of the body to remove (e.g. "Mars", "Moon").' },
      },
      required: ['name'],
    },
  },
  {
    name: 'load_preset',
    description: 'Loads a built-in simulation preset, replacing current state.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preset: {
          type: Type.STRING,
          description: 'One of: solar_system, rocket_system, real_scale_solar_system, asteroid_belt, trisolar_system, meteor_shower, black_hole_system, orbit_mission, artemis_2, rocket_on_earth, black_hole_devour',
        },
      },
      required: ['preset'],
    },
  },
  {
    name: 'load_vehicle',
    description: 'Places a rocket vehicle. Can be placed on the surface of a body OR in open space.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        bodyName: { type: Type.STRING, description: 'Name of the planet/body to land on. If omitted and no position is given, uses the largest body. Set to "none" or "space" to place in open space.' },
        vehicleType: { type: Type.STRING, description: '"rocket" (default) or "heatProtectedRocket".' },
        position: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } }, description: 'Optional: precise position in space.' },
        velocity: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } }, description: 'Optional: initial velocity.' },
      },
    },
  },
  {
    name: 'set_simulation_speed',
    description: 'Sets the simulation time scale (e.g. 1 = realtime, 100 = 100x speed).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeScale: { type: Type.NUMBER },
      },
      required: ['timeScale'],
    },
  },
  {
    name: 'inject_autopilot_script',
    description: 'Injects and runs a JavaScript autopilot script on a specific rocket vehicle. Defaults to the primary vehicle if no name is provided.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        script: { type: Type.STRING, description: 'Valid JavaScript autopilot script string.' },
        bodyName: { type: Type.STRING, description: 'Optional: name of the vehicle to target (e.g. "Orion", "Artemis SLS").' },
      },
      required: ['script'],
    },
  },
  {
    name: 'set_camera',
    description: 'Controls the simulation camera — zoom level and which body to follow.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        followBodyName: { type: Type.STRING, description: 'Name of the body to follow. Optional.' },
        zoom: { type: Type.NUMBER, description: 'Camera zoom level. Optional.' },
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

function executeTool(name: string, args: any, sim: Simulation, onScript?: (s: string, targetId?: string) => void): string {
  try {
    switch (name) {
      case 'replace_all_bodies': {
        if (args.G) sim.G = args.G;
        sim.bodies = (args.bodies || []).map((b: any) => ({
          id: typeof b.id === 'string' && b.id.length > 0 ? b.id : generateId(),
          name: b.name || 'Body',
          mass: b.mass ?? 1,
          radius: b.radius ?? 1,
          color: b.color ?? '#ffffff',
          position: { x: b.position?.x ?? 0, y: b.position?.y ?? 0, z: b.position?.z ?? 0 },
          velocity: { x: b.velocity?.x ?? 0, y: b.velocity?.y ?? 0, z: b.velocity?.z ?? 0 },
          trail: [],
          ...(b.isBlackHole ? { isBlackHole: true } : {}),
        }));
        sim.vehicle = null;
        sim.camera.followingId = sim.bodies[0]?.id ?? null;
        return `Loaded ${sim.bodies.length} bodies.`;
      }

      case 'add_body': {
        const b = args;
        sim.bodies.push({
          id: generateId(),
          name: b.name || 'Body',
          mass: b.mass ?? 1,
          radius: b.radius ?? 1,
          color: b.color ?? '#ffffff',
          position: { x: b.position?.x ?? 0, y: b.position?.y ?? 0, z: b.position?.z ?? 0 },
          velocity: { x: b.velocity?.x ?? 0, y: b.velocity?.y ?? 0, z: b.velocity?.z ?? 0 },
          trail: [],
          ...(b.isBlackHole ? { isBlackHole: true } : {}),
        });
        return `Added "${b.name}".`;
      }

      case 'load_vehicle': {
        const targetName = args.bodyName?.toLowerCase();
        const placeInSpace = targetName === 'none' || targetName === 'space' || (!targetName && args.position);

        let planet = null;
        if (!placeInSpace) {
          planet = targetName
            ? sim.bodies.find(b => b.name.toLowerCase().includes(targetName) && b !== (sim.vehicle as any))
            : sim.bodies.filter(b => b !== (sim.vehicle as any)).sort((a, b2) => b2.mass - a.mass)[0];

          if (!planet && targetName) {
            return `Body "${args.bodyName}" not found.`;
          }
        }

        // Artemis SLS metadata (mirrors getBodyMetadataFromPreset 'rocket')
        const length = 1.538e-5;
        const rocketMeta = {
          mass: 4.353e-19,
          radius: length / 2,
          length,
          color: '#ffffff',
          thrustPower: 2.5e-6,
          maxKineticEnergy: 20000,
        };

        let pos = args.position || { x: 0, y: 0 };
        let vel = args.velocity || { x: 0, y: 0 };
        let parentId = null;
        let relativeOffset = null;

        if (planet) {
          const surfaceOffset = { x: 0, y: -(planet.radius + rocketMeta.radius), z: 0 };
          pos = {
            x: planet.position.x + surfaceOffset.x,
            y: planet.position.y + surfaceOffset.y,
            z: planet.position.z + surfaceOffset.z,
          };
          vel = { x: planet.velocity.x, y: planet.velocity.y, z: planet.velocity.z };
          parentId = planet.id;
          relativeOffset = surfaceOffset;
        } else if (!args.position && sim.bodies.length > 0) {
          // Default space placement: near the first body if no position given
          const first = sim.bodies[0];
          pos = { x: first.position.x + first.radius * 4, y: first.position.y };
          vel = { x: first.velocity.x, y: first.velocity.y };
        }

        const rocket: any = {
          id: generateId(),
          name: 'Artemis SLS',
          mass: rocketMeta.mass,
          radius: rocketMeta.radius,
          length: rocketMeta.length,
          color: rocketMeta.color,
          position: pos,
          velocity: vel,
          trail: [],
          type: args.vehicleType || 'rocket',
          rotation: -Math.PI / 2,
          angularVelocity: 0,
          isHeatProtected: args.vehicleType === 'heatProtectedRocket',
          thrustPower: rocketMeta.thrustPower,
          maxKineticEnergy: rocketMeta.maxKineticEnergy,
          parentBodyId: parentId,
          relativeOffset: relativeOffset,
        };
        sim.bodies.push(rocket);
        sim.vehicle = rocket;
        sim.camera.followingId = rocket.id;
        sim.camera.zoom = 2000000;
        return planet ? `Rocket placed on "${planet.name}".` : `Rocket placed in space.`;
      }

      case 'remove_body': {
        const before = sim.bodies.length;
        sim.bodies = sim.bodies.filter(body => body.name.toLowerCase() !== args.name?.toLowerCase());
        const removed = before - sim.bodies.length;
        return removed > 0 ? `Removed "${args.name}".` : `Body "${args.name}" not found.`;
      }

      case 'load_preset': {
        const presetMap: Record<string, () => void> = {
          solar_system: () => sim.loadSolarSystem(),
          rocket_system: () => sim.loadRocketSystem(),
          real_scale_solar_system: () => sim.loadRealScaleSolarSystem(),
          asteroid_belt: () => sim.loadAsteroidBelt(),
          trisolar_system: () => sim.loadTrisolarSystem(),
          meteor_shower: () => sim.loadMeteorShower(),
          black_hole_system: () => sim.loadBlackHoleSystem(),
          orbit_mission: () => sim.loadOrbitMission(),
          rocket_on_earth: () => sim.loadRocketOnEarth(),
          black_hole_devour: () => sim.loadBlackHoleDevour(),
          artemis_2: () => sim.loadArtemis2Mission(),
        };
        const fn = presetMap[args.preset];
        if (fn) { fn(); return `Loaded preset: ${args.preset}`; }
        return `Unknown preset: ${args.preset}`;
      }

      case 'set_simulation_speed': {
        sim.timeScale = args.timeScale ?? 1;
        return `Speed set to ${sim.timeScale}x.`;
      }

      case 'inject_autopilot_script': {
        let targetId = (sim.vehicle || sim.bodies.find(b => (b as any).type === 'rocket' || (b as any).type === 'heatProtectedRocket'))?.id;
        if (args.bodyName) {
          const target = sim.bodies.find(b => b.name.toLowerCase().includes(args.bodyName.toLowerCase()));
          if (target) targetId = target.id;
        }
        if (onScript) onScript(args.script, targetId);
        return targetId ? 'Autopilot script injected to targeted vehicle.' : 'Autopilot script injected to primary vehicle.';
      }

      case 'set_camera': {
        if (args.zoom != null) sim.camera.zoom = args.zoom;
        if (args.followBodyName) {
          const target = sim.bodies.find(b => b.name.toLowerCase() === args.followBodyName.toLowerCase());
          if (target) sim.camera.followingId = target.id;
        }
        return 'Camera updated.';
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Tool error: ${err.message}`;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AIChat: React.FC<AIChatProps & { onInjectScript?: (s: string, targetId?: string) => void }> = ({
  sim, show, onClose, anchorRect, apiKey, onInjectScript, onSetApiKey
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
  // Raw Gemini multi-turn history (user/model parts)
  const historyRef = useRef<{ role: string; parts: { text: string }[] }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingMessage, isLoading]);

  // Handle Retry Countdown
  useEffect(() => {
    if (retryCountdown <= 0) return;
    const timer = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev <= 1) {
          // Clear the error message when countdown reaches 0
          setMessages(msgs => msgs.filter(m => !m.isError));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryCountdown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to UI
    setMessages(prev => [...prev, { role: 'user', text: userText }]);

    // Add to Gemini history
    historyRef.current.push({ role: 'user', parts: [{ text: userText }] });

    try {
      if (!apiKey) throw new Error('API key missing.');

      const ai = new GoogleGenAI({ apiKey });

      // Snapshot current sim state as context
      const simSnapshot = {
        G: sim.G,
        timeScale: sim.timeScale,
        bodyCount: sim.bodies.length,
        bodies: sim.bodies.map(b => ({
          id: b.id, name: b.name, mass: b.mass, radius: b.radius,
          position: b.position, velocity: b.velocity,
        })),
        hasVehicle: !!sim.vehicle,
      };

      const systemInstruction = `
You are Astro, a silent AI operator for a gravity physics simulation.

BEHAVIOR RULES:
- You operate by calling tools. 
- ALWAYS utilize your native reasoning API to express your internal logic or physics calculations before taking action.
- Use plain text responses to communicate with the user, provide feedback, or explain physics. This allows your speech to be streamed in real-time.
- Never confirm actions with text ("Done!", "I've created...", etc). Just execute.
- For solar systems and complex scenes, use "replace_all_bodies".
- For custom missions (e.g. "fly in a square", "orbit at X altitude"), use "add_body" or "replace_all_bodies" to setup the scene and "inject_autopilot_script" for the logic.
- Do NOT use "load_preset" if the user describes a specific mission, flight path, or logic. Presets are for generic starting points only.
- If the user says "in space" or "away from earth", do NOT include Earth or other massive bodies that would cause strong gravitational pull unless asked.
- Use "load_vehicle" to place a rocket on a planet or in open space. To place in space, omit "bodyName" or set it to "space", and optionally provide "position"/"velocity".
- Always check if a vehicle already exists in the "CURRENT SIMULATION STATE". If it does, you can just inject the script without reloading the vehicle unless asked.
- To control a specific vehicle when multiple exist, provide the "bodyName" in the inject_autopilot_script tool.

AVAILABLE PRESETS (use with load_preset tool):
- solar_system: Classic Sun + planets orbiting system
- rocket_system: Rocket vehicle with Earth
- artemis_2: 1:1 Real Scale Earth-Moon Artemis II mission (TLI Free Return Trajectory)
- real_scale_solar_system: Realistic scale solar system
- asteroid_belt: Sun with asteroid belt
- trisolar_system: Chaotic 3-star system (Three-Body Problem)
- meteor_shower: Meteor shower scenario
- black_hole_system: Black hole with orbiting bodies
- orbit_mission: Guided orbital insertion mission
- rocket_on_earth: Rocket on Earth surface ready to launch
- black_hole_devour: Black hole devouring the solar system

PHYSICS CONTEXT:
- G = ${sim.G} (gravitational constant)
- For stable orbits: velocity ≈ sqrt(G * central_mass / distance)
- Central body must be >> orbiting body mass for n-body stability
- Use beautiful distinct HSL colors

BODY TYPES & PROPERTIES:
- Normal star/planet: { name, mass, radius, color, position, velocity } — position/velocity are Vector3 {x, y, z}
- You are operating in a 3D simulation space. All coordinates are now 3D.
- BLACK HOLE: Add "isBlackHole": true to the body object. Use mass 1e7–1e10, radius ~0.5–5, color "#000000". Example:
  { "id": "bh1", "name": "Singularity", "mass": 5000000, "radius": 1.5, "color": "#000000", "isBlackHole": true, "position": {...}, "velocity": {...} }
- Smaller black holes as "planets": same isBlackHole: true, just lower mass (50000–500000) and closer orbits
- For a black hole system: central BH mass ~1e7, orbiting BH mass ~5e4–1e5, orbit distance 5–30 units

MASS REFERENCE:
- Stars: 10000–50000 | Planets: 1–50 | Moons: 0.01–1
- Central black hole: 1e6–1e8 | Orbiting black holes: 5e4–5e5

CURRENT SIMULATION STATE:
${JSON.stringify(simSnapshot, null, 2)}

AUTOPILOT SCRIPTING REFERENCE (fc API — use when writing inject_autopilot_script):
${FC_API_DOC}
`.trim();

      console.log('💬 [Astro] Conversation History:', historyRef.current);

      // Start streaming
      const result = await ai.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: historyRef.current as any,
        config: {
          systemInstruction,
          tools: [{
            functionDeclarations: TOOLS.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }))
          }],
          thinkingConfig: { includeThoughts: true } as any, // Explicitly enable native reasoning API
        },
      });

      let currentThought = '';
      let currentText = '';
      const toolCallParts: any[] = [];

      // Add placeholder message for streaming
      setStreamingMessage({ role: 'assistant', thought: '', text: '' });

      for await (const chunk of result) {
        console.log('📦 [Astro] Stream Chunk:', chunk);
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          const thought = (part as any).thought || (part as any).reasoning;
          if (thought) {
            currentThought += thought;
          }
          if (part.text) {
            currentText += part.text;
          }
          if (part.functionCall) {
            toolCallParts.push(part);
          }
        }

        // Update streaming message state immediately
        setStreamingMessage({
          role: 'assistant',
          thought: currentThought,
          text: currentText
        });
      }

      const toolCallNames: string[] = [];

      // Execute all tool calls found during streaming
      for (const part of toolCallParts) {
        const { name, args } = part.functionCall;
        const toolResult = executeTool(name, args, sim, onInjectScript);
        toolCallNames.push(name);
      }

      // Add full model response to history for next turn
      historyRef.current.push({
        role: 'model',
        parts: [
          ...(currentThought ? [{ thought: currentThought } as any] : []),
          ...(currentText ? [{ text: currentText }] : []),
          ...toolCallParts
        ]
      });

      // Commit streaming message to main messages list
      const finalAssistantMsg: Message = {
        role: 'assistant',
        thought: currentThought,
        text: currentText,
        toolCalls: toolCallNames
      };

      setMessages(prev => [...prev, finalAssistantMsg]);
      setStreamingMessage(null);

    } catch (err: any) {
      console.error(err);
      setStreamingMessage(null);

      // Attempt to parse deep error messages from the Gemini API
      let displayError = err.message || 'An unexpected error occurred.';
      let delaySeconds = 0;

      try {
        // Deep recursive search for specific fields in potentially nested JSON
        const findField = (obj: any, field: string): any => {
          if (!obj || typeof obj !== 'object') return null;
          if (obj[field]) return obj[field];
          for (const key in obj) {
            if (typeof obj[key] === 'string' && obj[key].startsWith('{')) {
              try {
                const res = findField(JSON.parse(obj[key]), field);
                if (res) return res;
              } catch (e) { }
            }
            const res = findField(obj[key], field);
            if (res) return res;
          }
          return null;
        };

        const errorObj = typeof err.message === 'string' && err.message.startsWith('{')
          ? JSON.parse(err.message)
          : err;

        // Try to find retryDelay anywhere in the error structure
        const details = findField(errorObj, 'details');
        if (Array.isArray(details)) {
          const retryInfo = details.find((d: any) => d.retryDelay);
          if (retryInfo) {
            delaySeconds = (parseInt(retryInfo.retryDelay) || 0) + 5;
          }
        } else {
          const directDelay = findField(errorObj, 'retryDelay');
          if (directDelay) delaySeconds = (parseInt(directDelay) || 0) + 5;
        }

        if (displayError.includes('Quota exceeded') || displayError.includes('429')) {
          const apiMsg = findField(errorObj, 'message');
          if (typeof apiMsg === 'string' && apiMsg.includes('Quota exceeded')) {
            displayError = apiMsg.split('\n')[0]; // Get the main error line
          } else {
            displayError = '🚀 Quota exceeded. Please wait a moment.';
          }
        } else {
          const apiMsg = findField(errorObj, 'message');
          if (apiMsg && typeof apiMsg === 'string' && !apiMsg.startsWith('{')) {
            displayError = apiMsg;
          }
        }
      } catch (e) {
        // Fallback to original strings
      }

      const errStr = JSON.stringify(err) + displayError;

      // Roll back: remove last user message from UI and history, restore to input
      setMessages(prev => prev.slice(0, -1));
      historyRef.current = historyRef.current.slice(0, -1);
      setInput(userText);

      if (delaySeconds > 0) {
        setRetryCountdown(delaySeconds);
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: `⚠ Quota exceeded. Retrying enabled in ${delaySeconds}s...`,
          isError: true
        }]);
      } else {
        const isUnavailable = errStr.includes('503') || errStr.includes('UNAVAILABLE');
        if (isUnavailable) {
          setMessages(prev => [...prev, { role: 'assistant', text: '⏳ Server busy — press Enter to retry.', isError: true }]);
          setTimeout(() => setMessages(prev => prev.filter(m => m.text !== '⏳ Server busy — press Enter to retry.')), 3000);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', text: `⚠ ${displayError}`, isError: true }]);
        }
      }

      // Auto-focus back to input for retry
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally {
      setIsLoading(false);
    }
  };

  const toolLabel: Record<string, string> = {
    load_vehicle: 'Vehicle deployed',
    replace_all_bodies: 'System rebuilt',
    add_body: 'Body added',
    remove_body: 'Body removed',
    load_preset: 'Preset loaded',
    set_simulation_speed: 'Speed adjusted',
    inject_autopilot_script: 'Autopilot injected',
    set_camera: 'Camera updated',
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          style={anchorRect && !isMobile ? {
            left: anchorRect.side === 'left' ? anchorRect.left : undefined,
            right: anchorRect.side === 'right' ? (window.innerWidth - anchorRect.left) : undefined,
            bottom: '80px',
          } : undefined}
          initial={isMobile ? { y: '100%', height: '60vh' } : { opacity: 0, y: 20, x: anchorRect ? 0 : '-50%' }}
          animate={isMobile
            ? { y: 0, height: '60vh' }
            : { opacity: 1, y: 0, x: anchorRect ? 0 : '-50%' }
          }
          exit={isMobile ? { y: '100%', height: '60vh' } : { opacity: 0, y: 20, x: anchorRect ? 0 : '-50%' }}
          transition={{ type: 'spring', damping: 40, stiffness: 200 }}
          drag={isMobile ? "y" : false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={isMobile ? { top: 0.1, bottom: 1 } : 0.5}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            if (isMobile && info.offset.y > 100) onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`fixed ${isMobile ? 'left-0 right-0 bottom-0 rounded-t-3xl border-t' : (!anchorRect ? 'bottom-[100px] left-1/2' : '')} ${isMobile ? '' : 'w-[380px]'} pointer-events-auto z-[100] will-change-transform bg-[#11141b]/95 backdrop-blur-3xl border-white/10 shadow-2xl flex flex-col overflow-hidden`}
        >
          {/* Mobile Handle */}
          {isMobile && (
            <div className="w-full flex justify-center py-3 shrink-0 cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>
          )}

          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-purple-400" />
                <span className="text-[10px] font-bold uppercase tracking-[2px] text-gray-400">AI Coordinator</span>
              </div>
              <div className="flex items-center gap-1">
                {!isMobile && (
                  <>
                    <button
                      onClick={() => {
                        setMessages([]);
                        historyRef.current = [];
                      }}
                      className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                      title="Clear Chat & Context"
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      onClick={onClose}
                      className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Message History */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0" style={{ maxHeight: '360px' }}>
              {messages.length === 0 && !apiKey && (
                // ── No API Key: prompt message ─────────────────────────────
                <div className="space-y-2 pt-1 text-center">
                  <div className="text-2xl">🔑</div>
                  <p className="text-[12px] text-gray-300 font-medium">API Key Required</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Paste your Gemini API key below to get started.{' '}
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">
                      Get one here.
                    </a>
                  </p>
                </div>
              )}

              {messages.length === 0 && apiKey && (
                // ── Has key: example prompts ───────────────────────────────
                <div className="space-y-2 pt-1">
                  {[
                    'Create a binary black hole system.',
                    'Add a moon to the largest planet.',
                    'Load rocket on Earth and set speed to 300x.',
                  ].map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(ex)}
                      className="w-full text-left bg-black/30 px-3 py-2.5 rounded-xl border border-white/5 text-gray-400 italic text-[11px] hover:border-purple-500/30 hover:text-gray-300 transition-all"
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="bg-purple-600/20 border border-purple-500/20 rounded-xl px-3 py-2 text-[12px] text-gray-200 max-w-[85%]">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-w-[90%]">
                      {/* Silent tool indicators */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {msg.toolCalls.map((t, j) => (
                            <span
                              key={j}
                              className="text-[9px] uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full"
                            >
                              ✓ {toolLabel[t] ?? t}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Thought balloon */}
                      {msg.thought && (
                        <div className="relative group max-w-full">
                          <div className="absolute -left-2 top-2 w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl rounded-tl-none px-3 py-2 text-[11px] text-indigo-300/90 italic leading-relaxed shadow-sm mb-2 backdrop-blur-sm">
                            <div className="flex items-center gap-1.5 mb-1 opacity-50">
                              <Sparkles size={10} className="text-indigo-400" />
                              <span className="text-[9px] uppercase tracking-[1px] font-bold">Neural Processing</span>
                            </div>
                            {msg.thought}
                          </div>
                        </div>
                      )}
                      {/* Spoken text (only when AI uses speak tool) */}
                      {msg.text && (
                        <div className={`rounded-xl px-3 py-2 text-[12px] ${msg.isError
                            ? 'bg-red-500/10 border border-red-500/20 text-red-400 font-mono'
                            : 'bg-white/5 border border-white/10 text-gray-300'
                          }`}>
                          {msg.isError && retryCountdown > 0 && msg.text.includes('Retrying enabled in')
                            ? `⚠ Quota exceeded. Retrying enabled in ${retryCountdown}s...`
                            : msg.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* ACTIVE STREAMING MESSAGE */}
              {streamingMessage && (
                <div className="flex justify-start">
                  <div className="space-y-1.5 max-w-[90%]">
                    {streamingMessage.thought && (
                      <div className="relative group max-w-full">
                        <div className="absolute -left-2 top-2 w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl rounded-tl-none px-3 py-2 text-[11px] text-indigo-300/90 italic leading-relaxed shadow-sm mb-2 backdrop-blur-sm">
                          <div className="flex items-center gap-1.5 mb-1 opacity-50">
                            <Sparkles size={10} className="text-indigo-400" />
                            <span className="text-[9px] uppercase tracking-[1px] font-bold">Neural Processing</span>
                          </div>
                          {streamingMessage.thought}
                        </div>
                      </div>
                    )}
                    {streamingMessage.text && (
                      <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[12px] text-gray-300">
                        {streamingMessage.text}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isLoading && !streamingMessage && (
                <div className="flex justify-start">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-gray-600 text-[11px]">
                      <Loader2 size={12} className="animate-spin text-purple-400" />
                      <span>Astro is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-white/5 px-3 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!apiKey) {
                    // Use input as API key
                    if (input.trim() && onSetApiKey) {
                      onSetApiKey(input.trim());
                      setInput('');
                    }
                  } else {
                    handleSubmit(e);
                  }
                }}
                className="relative"
              >
                <input
                  ref={inputRef}
                  type={!apiKey ? 'password' : 'text'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={!apiKey ? 'Paste your Gemini API key...' : retryCountdown > 0 ? `Wait ${retryCountdown}s...` : 'Command the simulation...'}
                  className={`bg-black/40 border border-white/5 rounded-xl py-2.5 pl-4 pr-11 w-full text-[13px] text-gray-200 outline-none focus:border-purple-500/50 transition-all font-mono placeholder:text-gray-600 ${retryCountdown > 0 ? 'opacity-50 grayscale' : ''}`}
                  disabled={isLoading || retryCountdown > 0}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || retryCountdown > 0}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
              </form>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
